// Prueba de los 3 flujos que no se pueden romper, por HTTP real contra el servidor corriendo:
//   (a) efectivo + Yape   (b) efectivo + Yape + fiado   (c) "te yapeo 40, dame el vuelto"
// y la caja del turno al final.
//
// Crea ventas y abre caja: úsalo SOLO con una base de prueba recién sembrada
// (npm run db:seed) y PAYMENTS_PROVIDER=mock (usa "Simular pago").
//
//   npm run test:flujos -- --base-de-prueba [--url http://localhost:3000]
import { randomUUID } from 'node:crypto';
const args = process.argv.slice(2);
if (!args.includes('--base-de-prueba')) {
  console.error('Esta prueba crea ventas y abre caja. Úsala solo con una base de prueba:');
  console.error('  npm run test:flujos -- --base-de-prueba [--url http://localhost:3000]');
  process.exit(2);
}
const urlArg = args.indexOf('--url');
const BASE = urlArg >= 0 ? args[urlArg + 1] : 'http://localhost:3000';
let ok = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ✔ ${name}`); } else { fail++; console.log(`  ✘ ${name} ${detail}`); }
};
async function call(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, body: json, text };
}
const login = async (username, secret) => (await call('POST', '/auth/login', null, { username, secret })).body.accessToken;

const health = await call('GET', '/health').catch(() => ({ status: 0, body: {} }));
if (health.status !== 200) {
  console.error(`No responde ${BASE}. ¿Está corriendo el servidor (npm run dev:backend)?`);
  process.exit(2);
}
const vend = await login('carlos', '1111');
const admin = await login('admin', '1234');
check('login vendedor y admin', !!vend && !!admin);

const products = (await call('GET', '/products?limit=200', vend)).body;
const list = Array.isArray(products) ? products : products.items ?? products.data ?? [];
const find = (s) => list.find((p) => p.name.toLowerCase().includes(s.toLowerCase()));
const pilsen = find('Pilsen'), inca = find('Inca Kola 1.5'), coca = find('Coca-Cola');
const primor = find('Primor'), leche = find('Gloria'), pan = find('Pan');
check('catálogo trae los productos del seed', pilsen && inca && coca && primor && leche && pan, `(${list.length} productos)`);
const price = (p) => p.priceCents;
const items50 = [
  { productId: pilsen.id, quantity: 4, unitPriceCents: price(pilsen) },
  { productId: inca.id, quantity: 2, unitPriceCents: price(inca) },
  { productId: coca.id, quantity: 2, unitPriceCents: price(coca) },
];
const total50 = items50.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0);
const items32 = [
  { productId: primor.id, quantity: 2, unitPriceCents: price(primor) },
  { productId: leche.id, quantity: 2, unitPriceCents: price(leche) },
  { productId: pan.id, quantity: 4, unitPriceCents: price(pan) },
];
const total32 = items32.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0);
console.log(`  (venta A = S/ ${total50 / 100}, venta B = S/ ${total32 / 100})`);

const open = await call('POST', '/cash/open', vend, { openingCents: 10000 });
check('abrir caja con S/ 100 (si falla: ya había una caja abierta, siembra la base de nuevo)', open.status === 201 || open.status === 200, `${open.status} ${open.text}`);

const sale = (items, payments, extra = {}) => ({
  id: randomUUID(), createdAt: new Date().toISOString(), discountCents: 0, customerId: null, docType: 'TICKET', items, payments, ...extra,
});
async function paidQr(amountCents, reference, wallet = 'YAPE') {
  const c = await call('POST', '/payments/qr', vend, { amountCents, reference });
  await call('POST', `/payments/qr/${c.body.id}/simulate`, vend, { wallet });
  const st = await call('GET', `/payments/qr/${c.body.id}`, vend);
  return { id: c.body.id, status: st.body?.status };
}

console.log('\n(a) efectivo + Yape en la misma venta');
{
  const yape = total50 - 2000;
  const s = sale(items50, []);
  const qr = await paidQr(yape, s.id);
  check('QR por la parte de Yape queda pagado', qr.status === 'PAID', `estado=${qr.status}`);
  s.payments = [
    { method: 'CASH', amountCents: 2000, tenderedCents: 5000 },
    { method: 'YAPE', amountCents: yape, confirmation: 'QR', chargeId: qr.id },
  ];
  const r = await call('POST', '/sales', vend, s);
  check('venta registrada', r.status === 201, `${r.status} ${r.text}`);
  check('vuelto = 50 − 20 = S/ 30', r.body?.changeCents === 3000, `vuelto=${r.body?.changeCents}`);
  const again = await call('POST', '/sales', vend, s);
  check('reenviar la misma venta no la duplica', again.status < 300 && again.body?.id === s.id, `${again.status}`);
  const reuse = sale(items50, [{ method: 'YAPE', amountCents: total50, confirmation: 'QR', chargeId: qr.id }]);
  const rr = await call('POST', '/sales', vend, reuse);
  check('el mismo QR no sirve para otra venta', rr.status >= 400, `${rr.status}`);
}

console.log('\n(b) efectivo + Yape + fiado en la misma venta');
{
  const custs = (await call('GET', '/customers', vend)).body;
  const clist = Array.isArray(custs) ? custs : custs.items ?? custs.data ?? [];
  const pedro = clist.find((c) => c.name.includes('Pedro')) ?? clist[0];
  const before = (await call('GET', `/customers/${pedro.id}`, admin)).body.customer.balanceCents;
  const fiado = 2000, cash = 1000, yape = total50 - fiado - cash;
  const s = sale(items50, [], { customerId: pedro.id });
  const qr = await paidQr(yape, s.id);
  s.payments = [
    { method: 'CASH', amountCents: cash, tenderedCents: 2000 },
    { method: 'YAPE', amountCents: yape, confirmation: 'QR', chargeId: qr.id },
    { method: 'FIADO', amountCents: fiado },
  ];
  const r = await call('POST', '/sales', vend, s);
  check('venta registrada', r.status === 201, `${r.status} ${r.text}`);
  check('tres pagos guardados en orden', JSON.stringify(r.body?.payments?.map((p) => p.method)) === '["CASH","YAPE","FIADO"]');
  check('vuelto del efectivo = S/ 10', r.body?.changeCents === 1000, `vuelto=${r.body?.changeCents}`);
  const after = (await call('GET', `/customers/${pedro.id}`, admin)).body.customer.balanceCents;
  check(`deuda de ${pedro.name} sube S/ 20`, after - before === fiado, `antes=${before} después=${after}`);
  const noCust = sale(items50, [{ method: 'FIADO', amountCents: total50 }]);
  const nc = await call('POST', '/sales', vend, noCust);
  check('fiado sin cliente se rechaza', nc.status >= 400, `${nc.status}`);
}

console.log('\n(c) "te yapeo 40, dame el vuelto"');
{
  const s = sale(items32, []);
  const exact = await paidQr(total32, s.id);
  s.payments = [{ method: 'YAPE', amountCents: total32, tenderedCents: 4000, confirmation: 'QR', chargeId: exact.id }];
  const bad = await call('POST', '/sales', vend, s);
  check('QR por 32 no vale como si fueran 40', bad.body?.code === 'QR_MONTO_DISTINTO', `${bad.status} ${bad.body?.code}`);
  const qr40 = await paidQr(4000, s.id);
  s.payments = [{ method: 'YAPE', amountCents: total32, tenderedCents: 4000, confirmation: 'QR', chargeId: qr40.id }];
  const r = await call('POST', '/sales', vend, s);
  check('venta registrada', r.status === 201, `${r.status} ${r.text}`);
  check(`vuelto = 40 − ${total32 / 100} = S/ ${(4000 - total32) / 100}`, r.body?.changeCents === 4000 - total32, `vuelto=${r.body?.changeCents}`);
  const t = await call('GET', `/sales/${s.id}/receipt`, vend);
  check('ticket dice "Recibido S/ 40.00" y el VUELTO', /Recibido\s+S\/ 40\.00/.test(t.text) && new RegExp(`VUELTO\\s+S/ ${((4000 - total32) / 100).toFixed(2)}`).test(t.text));
}

console.log('\nCaja del turno');
{
  const c = (await call('GET', '/cash/current', vend)).body;
  // Efectivo asignado: 20 (a) + 10 (b) = 30. Vuelto de yapeo: 40 − venta B.
  const vueltoYape = 4000 - total32;
  check('efectivo por ventas = S/ 30', c.byMethod?.CASH === 3000, JSON.stringify(c.byMethod));
  check(`vuelto de yapeos = S/ ${vueltoYape / 100}`, c.digitalChangeCents === vueltoYape, `${c.digitalChangeCents}`);
  check(`esperado en cajón = 100 + 30 − ${vueltoYape / 100} = S/ ${(13000 - vueltoYape) / 100}`, c.expectedCents === 13000 - vueltoYape, `${c.expectedCents}`);
}

console.log(`\nResultado: ${ok} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
