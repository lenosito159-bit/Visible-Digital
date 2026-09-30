# PeruPOS

App de ventas para **bodegas, minimarkets y puestos de mercado del Perú**. Se vende con el
celular, se escanea el código de barras, se cobra **efectivo + Yape/Plin + fiado en la misma
venta**, se lleva el **cuaderno de fiados** en el celular, se cuadra la caja y se emiten
comprobantes para SUNAT. **Funciona sin señal** y envía todo cuando vuelve.

- App: React Native + Expo SDK 57, TypeScript, SQLite en el celular. Android e iOS.
- Servidor: Node.js 22 + Express + PostgreSQL.
- Yape/Plin: QR interoperable de **TAYPI** (un solo QR para Yape, Plin y bancos) con su SDK oficial `taypi.pe`.
- Comprobantes: PSE **Nubefact** (boletas y facturas) y archivo para el **SIRE**.

```
perupos/
├── shared/    Reglas de negocio: IGV, pagos mixtos, fiado, permisos, ticket, WhatsApp
├── backend/   API Express + PostgreSQL (migraciones, seed, tests, scripts)
├── mobile/    App Expo (eas.json, app.config.ts)
└── scripts/   smoke-test.md: prueba en el celular en 15 pasos
```

Estado de las pruebas: [`QA.md`](QA.md) · Cambios: [`CHANGELOG.md`](CHANGELOG.md)

---

## 1. Instalación paso a paso

### Lo que necesitas

- Node.js 22.12 o superior y PostgreSQL 14 o superior
- Una cuenta gratuita en [expo.dev](https://expo.dev) para generar el APK
- Un Android (ideal: el mismo celular que usará el vendedor)

### Servidor

```bash
cd perupos
npm install                      # instala todo y compila @perupos/shared

createuser -P perupos            # contraseña: perupos (o la que pongas en DATABASE_URL)
createdb -O perupos perupos

cp backend/.env.example backend/.env
# edita backend/.env: JWT_SECRET, RUC, razón social y dirección del negocio

npm run db:migrate
npm run db:seed -- --demo        # 20 productos, 3 usuarios, 4 clientes y 4 semanas de ventas
npm run dev:backend              # http://localhost:3000
```

Sin `--demo` solo se cargan los datos base.

### App en el celular

- **Para probar rápido** (Expo Go, sin push): desde `perupos/mobile`,
  `EXPO_PUBLIC_API_URL=http://IP-DE-TU-PC:3000 npx expo start` y escanea el QR con Expo Go.
- **APK para la tienda:** sigue [QA.md → Cómo instalar el APK](QA.md#cómo-instalar-el-apk-en-un-android-paso-a-paso).
  En resumen, desde `perupos/mobile`:
  ```bash
  npx eas-cli@latest login
  npx eas-cli@latest init
  npx eas-cli@latest build --platform android --profile preview
  ```
  Antes, pon la IP de tu PC en `mobile/eas.json` (`EXPO_PUBLIC_API_URL`).

### Usuarios de prueba

| Rol | Usuario | PIN |
| --- | --- | --- |
| Administrador | `admin` | `1234` |
| Vendedor | `carlos` | `1111` |
| Agente Financiero | `lucia` | `2222` |

**Cámbialos** en *Administrador → Usuarios* antes de usar la app en tu tienda. Tras 5 PIN
equivocados el usuario se bloquea 5 minutos.

---

## 2. Cómo se usa en una bodega peruana real

### "¿Yapeas?" — venta mixta
El cliente lleva S/ 50 y dice *"te doy 20 en efectivo y el resto te yapeo"*.
1. *Nueva Venta* → escanea o toca los productos → **Cobrar S/ 50.00**.
2. En Efectivo escribe `20` → **+ Agregar otro método** → **Yape**: se llena solo con **S/ 30.00**.
3. Toca el billete que te dio en "¿Con cuánto paga?": ves el **VUELTO** en grande.
4. **Cobrar** → sale un QR por S/ 30.00 que sirve para **Yape y Plin** (2 minutos). Cuando paga, la venta se registra sola.

Otros casos que ya funcionan igual:
- *"Tengo 15 sueltos, ¿me completas con Plin?"* → Efectivo 15 + Plin (se llena el resto).
- *"10 en efectivo, 20 te yapeo y 20 apúntamelo"* → tres métodos: el **resto va siempre al último** que agregas.
- *"Te yapeo 40, dame el vuelto"* (cuenta de 32) → en la línea de Yape toca **"Me yapeó más: dar vuelto"** y escribe 40: el QR sale por 40 y la app te dice que des S/ 8.00 de vuelto del cajón.
- **Te yapeó a tu QR del mostrador** (o no hay señal) → *"Me yapeó a mi QR del mostrador"* → mira tu notificación y escribe el **N° de operación**. Si alguien intenta usar el mismo número otra vez, la app lo rechaza.

### "Apúntamelo" — el fiado
- **Fiado total:** en Cobrar cambia Efectivo por **Fiado** y elige al cliente (o créalo ahí mismo).
- **Fiado parcial:** *"Lleva 80, me da 30 y los 50 apúntamelos"* → Efectivo 30 + Fiado (se llena con 50).
- **Límite:** cada cliente tiene un "hasta cuánto le fías". Si se pasa, el dueño escribe su PIN en el celular del vendedor para autorizar (necesita señal).
- **Abono:** *"Te abono 20 de los 45"* → *Abono* → cliente → `20` → Efectivo, Yape o Plin → constancia con el **saldo que queda**, para mandar por WhatsApp.
- **Cuaderno:** en la ficha del cliente ves cada "fió" y "abonó" con fecha y quién lo anotó.
- **Trato y marca:** eliges si le dices **Don / Doña** o solo su nombre (la app nunca lo adivina), y lo marcas como **"Siempre paga"** o **"Le cuesta pagar"**.
- **Cobrar por WhatsApp:** *Fiado → Por cobrar* ordena por monto o antigüedad; **Vencidos** son los que llevan más de 30 días sin abonar. El mensaje es respetuoso:
  > *Don Juan, le recuerdo su cuenta: S/ 45.00 desde el 12 de setiembre. Cuando pueda, aquí lo espero. Gracias, Bodega Doña Rosa.*

  Hay plantillas de **quincena**, **fin de mes** y **segundo aviso**. Los días 14 al 16 y a fin de mes la app te avisa que es buen día para cobrar.

### "¿Cuadra la caja?" — el cierre
1. En la mañana: *Caja* → **Abrir caja** con el sencillo que tienes.
2. Durante el día: **Saco plata** (le pagué al de las gaseosas) o **Meto plata**.
3. Al cerrar: la app muestra lo vendido **por método** (efectivo, Yape, Plin, fiado) y los abonos. Cuenta el cajón y escríbelo. Si le **yapeaste al administrador** para cuadrar, anótalo aparte.
4. Te dice **"Cuadra exacto"**, **"Faltan S/ X"** o **"Sobran S/ X"**, y mandas el resumen por WhatsApp al dueño.

### Sin señal
La barra de arriba se pone **ámbar**: *"No hay señal — sigue vendiendo nomás · 3 por enviar"*.
Todo queda guardado en el celular y se envía solo cuando vuelve. Sin señal **no** se puede:
generar el QR (usa tu QR del mostrador), autorizar un fiado o descuento, ni cuadrar la caja.

### Roles

| Qué puede hacer | Admin | Vendedor | Agente |
| --- | :-: | :-: | :-: |
| Vender, fiar, cobrar abonos, abrir y cerrar caja | ✅ | ✅ | — |
| Crear un producto nuevo desde la caja | ✅ | ✅ | — |
| Cambiar precios, stock, IGV; anular ventas | ✅ | — | — |
| Descuento > 10 %, fiado sobre el límite | ✅ | con PIN del Admin | — |
| Usuarios, datos del negocio, cuentas, Yape/Plin | ✅ | — | — |
| Tablero financiero, alertas, enviar recomendaciones | ✅ | ve sus alertas | ✅ |
| Libro de ventas para el SIRE | ✅ | — | — |

Alertas automáticas (push, cada una en su propio canal de Android): **stock bajo**,
**cliente cerca de su límite de fiado**, **caja baja** (menos de S/ 50 para vuelto), **fiado
vencido** (+30 días sin abonar) y **producto sin movimiento** (15 días sin venderse).

---

## 3. Variables de entorno (`backend/.env`)

| Variable | Para qué sirve |
| --- | --- |
| `DATABASE_URL` | Conexión a PostgreSQL |
| `JWT_SECRET` | Clave de las sesiones (mínimo 32 caracteres, aleatoria) |
| `BUSINESS_RUC`, `BUSINESS_RAZON_SOCIAL`, `BUSINESS_NOMBRE_COMERCIAL`, `BUSINESS_DIRECCION`, `BUSINESS_UBIGEO`, `BUSINESS_PHONE` | Datos del negocio para el seed (luego se editan en *Mi negocio*) |
| `BUSINESS_TAX_REGIME` | `NRUS`, `RER`, `RMT` o `GENERAL` |
| `SEED_ADMIN_PIN`, `SEED_VENDEDOR_PIN`, `SEED_AGENTE_PIN` | PIN iniciales de los usuarios de prueba |
| `PAYMENTS_PROVIDER` | `mock` (prueba, sin cobros reales) o `taypi` |
| `TAYPI_PUBLIC_KEY`, `TAYPI_SECRET_KEY` | Llaves de TAYPI (`taypi_pk_…`, `taypi_sk_…`) |
| `TAYPI_WEBHOOK_SECRET` | Secreto para verificar los webhooks de pago |
| `TAYPI_BASE_URL` | `https://sandbox.taypi.pe` (pruebas) o `https://app.taypi.pe` (producción) |
| `TAYPI_DEBUG` | `true` registra todas las respuestas crudas de TAYPI (por defecto, solo la primera de cada tipo) |
| `TAYPI_TEST_ENDPOINT` | Activa `POST /webhooks/taypi/test`. Vacío = activo salvo en producción. **Nunca en producción** |
| `QR_TTL_SECONDS` | Tiempo para pagar el QR (120 = 2 minutos) |
| `MOCK_AUTOPAY_SECONDS` | Solo `mock`: el QR se paga solo tras N segundos (para demos) |
| `PSE_PROVIDER` | `mock` (simula a SUNAT), `nubefact` o `none` |
| `NUBEFACT_URL`, `NUBEFACT_TOKEN` | "RUTA" y "TOKEN" de la API de Nubefact |
| `PUSH_ENABLED`, `EXPO_ACCESS_TOKEN` | Notificaciones push con Expo |
| `ALERTS_INTERVAL_MINUTES` | Cada cuánto se revisan las alertas (15) |

En la app (`mobile/eas.json`): `EXPO_PUBLIC_API_URL` por perfil de build.
Las llaves de TAYPI y del PSE viven **solo en el servidor**; nunca se envían al celular.

### Scripts útiles (desde `perupos/`)

| Comando | Qué hace |
| --- | --- |
| `npm run taypi:check -w @perupos/backend` | Cobro de S/ 1.00 en el sandbox de TAYPI: muestra la respuesta cruda y lo anula |
| `npm run pse:check -w @perupos/backend -- --serie BBB1 --numero 1 [--dry-run]` | Boleta de prueba a Nubefact (demo) |
| `npm run padron:import -w @perupos/backend -- --file padron_reducido_ruc.txt` | Carga el Padrón Reducido de SUNAT para verificar RUC |
| `npm run perufoodnet:import -w @perupos/backend -- --dir /ruta --create` | Fotos de platos preparados (ver §5) |

---

## 4. Qué falta antes de usarlo con dinero real

En orden. Detalle y estado de cada punto en [`QA.md`](QA.md).

1. **Probar el APK en el celular** con [`scripts/smoke-test.md`](scripts/smoke-test.md).
   Ninguna pantalla se probó todavía en un celular real.
2. **TAYPI sandbox** con tus llaves: `npm run taypi:check`, pagar un QR y ver el webhook.
   Los nombres de los campos del QR y el formato del webhook no están confirmados: el SDK no
   los documenta y el primer uso real queda registrado en el log para ajustarlos.
3. **Servidor con HTTPS** para el perfil `production` (Android bloquea http en producción).
4. **Nubefact demo**: `npm run pse:check` y comparar con el ticket de la app.
5. **Contador**: régimen tributario, afectación al IGV de cada producto y el archivo del SIRE
   (las columnas no se pudieron contrastar con el anexo oficial desde aquí).
6. **Cambiar los PIN** de los usuarios de prueba y el `JWT_SECRET`.

No implementado: Ticket POS del Nuevo RUS (necesita un PSE-CF), IVAP del arroz pilado,
ICBPER de bolsas, notas de crédito, ticketeras Bluetooth, consulta de RUC en línea a SUNAT
(se usa una copia local del padrón).

---

## 5. Notas técnicas

- **Sin señal:** cada venta lleva un id generado en el celular; si se reenvía, el servidor no
  la duplica. Precios cambiados mientras el celular estaba desconectado se aceptan hasta 30 días
  y quedan en la auditoría.
- **IGV:** incluido en el precio (base = total / 1.18). En el Nuevo RUS no se discrimina.
  Boletas > S/ 700 piden DNI; facturas, RUC válido.
- **RUC:** se valida el dígito verificador siempre. Con el Padrón Reducido cargado, además
  razón social, estado y condición (al emitir factura se llena sola la razón social).
- **Imágenes:** PeruFoodNet (Mendeley Data, `10.17632/hxhbbm497d`) tiene 4,000 fotos de 40
  **platos preparados**, no de abarrotes. Solo sirve para menú, ceviche, lomo saltado, etc.
  Para lo demás se usa la foto que toma el vendedor. Revisa su licencia antes de usarlo comercialmente.
- **Rendimiento:** catálogo por páginas, listas virtualizadas, fotos en caché y respuestas
  comprimidas (con 1,020 productos la descarga inicial baja de 289 KB a 35 KB).

### Desarrollo

```bash
npm test                             # shared + backend contra PostgreSQL (base perupos_test, se borra)
npm run typecheck                    # shared, backend y app
npm run bundle -w @perupos/mobile    # bundle Android con Metro
```

El workflow `.github/workflows/perupos.yml` corre typecheck y tests en cada cambio.

### API (resumen)

| Método y ruta | Uso |
| --- | --- |
| `POST /auth/login`, `/auth/refresh`, `/auth/authorize`, `/auth/push-token` | Sesión, autorización del Admin, push |
| `GET /sync/pull?since=` · `POST /sync/push` | Sincronización sin señal |
| `GET/POST /products`, `PATCH /products/:id`, `POST /products/:id/image`, `/restock` | Catálogo |
| `POST /sales`, `GET /sales`, `GET /sales/:id/receipt`, `POST /sales/:id/void` | Ventas |
| `POST /payments/qr`, `GET /payments/qr/:id`, `POST /payments/qr/:id/cancel` | QR Yape/Plin |
| `POST /webhooks/taypi` · `POST /webhooks/taypi/test` | Webhook real · simulación firmada (solo Admin, no en producción) |
| `GET/POST/PATCH /customers`, `POST /abonos` | Fiado y abonos |
| `GET /cash/current`, `POST /cash/open`, `/cash/movements`, `/cash/close`, `GET /cash/closures` | Caja |
| `GET /ruc/:ruc` | Verificación de RUC (formato + padrón local) |
| `GET /agent/dashboard`, `/reports/*`, `/reports/sire?period=AAAAMM` | Reportes y SIRE |
| `GET /alerts`, `POST /alerts/evaluate`, `POST/GET /notifications` | Alertas y mensajes |
| `GET/PUT /settings`, `/users`, `/bank-accounts`, `/doc-series` | Administración |
