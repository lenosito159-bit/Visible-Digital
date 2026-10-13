import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type Actor,
  backupReminder,
  base64Decode,
  base64Encode,
  createBackup,
  createProduct,
  getBusiness,
  listProducts,
  markBackupDone,
  markBackupVerified,
  migrateLocal,
  openBackup,
  peekBackup,
  recordSale,
  restoreBackup,
  setupBusiness,
  unlock,
  utf8Decode,
  utf8Encode,
  encryptBackup,
} from '../src/local/index.js';
import { nodeCrypto as c, nodeLocalDb } from './node-local-db.js';

let db: ReturnType<typeof nodeLocalDb>;
let owner: Actor;
const PASSWORD = 'bodega rosita 2026';

beforeEach(async () => {
  db = nodeLocalDb();
  await migrateLocal(db);
  const s = await setupBusiness(db, c, { businessName: 'Bodega Doña Rosa', ownerName: 'Rosa', pin: '2580' });
  owner = { id: s.owner.id, name: 'Rosa', role: 'ADMIN' };
  const p = await createProduct(db, c, owner, { name: 'Ñoquis a granel — señora Peña', priceCents: 900, stock: 10, unit: 'KG' });
  await recordSale(
    db, c,
    { id: randomUUID(), createdAt: '', items: [{ productId: p.id, quantity: 1.5, unitPriceCents: 900 }], payments: [{ method: 'YAPE', amountCents: 1350, confirmation: 'MANUAL', reference: '445566' }], discountCents: 0, customerId: null, docType: 'TICKET' },
    owner,
  );
});
afterEach(() => db.close());

describe('copia con contraseña', () => {
  it('sin la contraseña no se ve nada del negocio salvo el nombre y la fecha', async () => {
    const enc = await encryptBackup(await createBackup(db, c), PASSWORD, c);
    const text = JSON.stringify(enc);
    expect(text).not.toContain('Ñoquis');
    expect(text).not.toContain('445566');
    expect(text).not.toContain('pin_hash');
    expect(peekBackup(text)).toEqual({ encrypted: true, businessName: 'Bodega Doña Rosa', isDemo: false, createdAt: enc.createdAt });
  });

  it('con la contraseña correcta se recupera todo en otro celular', async () => {
    const text = JSON.stringify(await encryptBackup(await createBackup(db, c), PASSWORD, c));
    const phoneB = nodeLocalDb();
    await migrateLocal(phoneB);
    const opened = await openBackup(c, text, PASSWORD);
    await restoreBackup(phoneB, opened);
    expect((await listProducts(phoneB)).map((p) => p.name)).toEqual(['Ñoquis a granel — señora Peña']);
    expect((await listProducts(phoneB))[0]!.stock).toBe(8.5);
    expect((await unlock(phoneB, c, owner.id, '2580')).ok).toBe(true);
    phoneB.close();
  });

  it('contraseña equivocada, sin contraseña o archivo cambiado: no se abre', async () => {
    const enc = await encryptBackup(await createBackup(db, c), PASSWORD, c);
    const text = JSON.stringify(enc);
    await expect(openBackup(c, text)).rejects.toMatchObject({ code: 'NECESITA_CONTRASENA' });
    await expect(openBackup(c, text, 'bodega rosita 2025')).rejects.toMatchObject({ code: 'CONTRASENA_INCORRECTA' });
    await expect(openBackup(c, text, 'Bodega rosita 2026')).rejects.toMatchObject({ code: 'CONTRASENA_INCORRECTA' });
    // Un solo byte cambiado en el contenido cifrado.
    const bytes = base64Decode(enc.data);
    bytes[100] = bytes[100]! ^ 1;
    const tampered = JSON.stringify({ ...enc, data: base64Encode(bytes) });
    await expect(openBackup(c, tampered, PASSWORD)).rejects.toMatchObject({ code: 'CONTRASENA_INCORRECTA' });
    await expect(openBackup(c, '{"app":"otra"}', PASSWORD)).rejects.toMatchObject({ code: 'NO_ES_COPIA' });
  });

  it('la contraseña debe tener al menos 8 caracteres', async () => {
    await expect(encryptBackup(await createBackup(db, c), '1234', c)).rejects.toMatchObject({ code: 'CONTRASENA_CORTA' });
  });

  it('dos copias con la misma contraseña no salen iguales (sal y nonce al azar)', async () => {
    const backup = await createBackup(db, c);
    const a = await encryptBackup(backup, PASSWORD, c);
    const b = await encryptBackup(backup, PASSWORD, c);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.data).not.toBe(b.data);
  });

  it('las copias antiguas sin contraseña todavía se pueden recuperar', async () => {
    const plain = JSON.stringify(await createBackup(db, c));
    expect(peekBackup(plain).encrypted).toBe(false);
    expect((await openBackup(c, plain)).business.name).toBe('Bodega Doña Rosa');
  });
});

describe('copia hecha ≠ copia guardada', () => {
  it('abrir el menú de compartir no cuenta: el recordatorio sigue hasta comprobar la copia', async () => {
    const now = new Date();
    expect(await backupReminder(db, now)).toContain('Todavía no tienes una copia');
    await markBackupDone(db, now);
    expect(await backupReminder(db, now)).toContain('no comprobaste');
    expect((await getBusiness(db))!.backupVerifiedAt).toBeNull();
    await markBackupVerified(db, now.toISOString(), now);
    expect(await backupReminder(db, now)).toBeNull();
    expect(await backupReminder(db, new Date(now.getTime() + 8 * 86_400_000))).toContain('hace 8 días');
  });

  it('recuperar una copia la cuenta como comprobada', async () => {
    const text = JSON.stringify(await encryptBackup(await createBackup(db, c), PASSWORD, c));
    const phoneB = nodeLocalDb();
    await migrateLocal(phoneB);
    await restoreBackup(phoneB, await openBackup(c, text, PASSWORD));
    expect((await getBusiness(phoneB))!.backupVerifiedAt).not.toBeNull();
    expect(await backupReminder(phoneB)).toBeNull();
    phoneB.close();
  });
});

describe('utilidades', () => {
  it('UTF-8 y base64 de ida y vuelta (tildes, ñ, emojis, binario)', () => {
    const text = 'Señora Peña — café, ñandú, 🥖 y 💸';
    expect(utf8Decode(utf8Encode(text))).toBe(text);
    expect(Buffer.from(utf8Encode(text)).toString('utf8')).toBe(text);
    for (const n of [0, 1, 2, 3, 100, 1001]) {
      const bytes = new Uint8Array(randomBytes(n));
      expect(base64Encode(bytes)).toBe(Buffer.from(bytes).toString('base64'));
      expect(base64Decode(base64Encode(bytes))).toEqual(bytes);
    }
  });
});
