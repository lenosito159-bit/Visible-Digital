# PeruPOS

Punto de venta para **bodegas, minimercados y tiendas de barrio del Perú**. Vende con el
celular, escanea códigos de barras, cobra **efectivo + Yape/Plin en la misma venta**,
lleva el **cuaderno de fiados** digital, emite comprobantes para SUNAT y **funciona sin
internet**.

- App: React Native + Expo (SDK 57), TypeScript, SQLite local, iOS y Android.
- API: Node.js + Express + PostgreSQL.
- Pagos: QR interoperable de **TAYPI** (un solo QR para Yape, Plin y bancos) con su SDK oficial `taypi.pe`.
- Comprobantes: PSE **Nubefact** (boletas y facturas) y export del **SIRE**.

```
perupos/
├── shared/    Tipos y reglas de negocio (IGV, pagos mixtos, permisos, ticket, WhatsApp)
├── backend/   API Express + PostgreSQL (migraciones, seed, tests)
└── mobile/    App Expo (expo-router, expo-camera, expo-sqlite, expo-notifications)
```

---

## 1. Instalación

### Requisitos

- Node.js 22.12 o superior
- PostgreSQL 14 o superior
- Para probar la app: un celular con **Expo Go** o un *development build* (ver §4)

### Pasos

```bash
cd perupos
npm install                 # instala todo y compila @perupos/shared

# Base de datos
createuser -P perupos       # contraseña: perupos (o la que pongas en DATABASE_URL)
createdb -O perupos perupos

# Configuración del servidor
cp backend/.env.example backend/.env
# edita backend/.env: JWT_SECRET, RUC, razón social, llaves de TAYPI y del PSE

npm run db:migrate          # crea las tablas
npm run db:seed -- --demo   # 20 productos, 3 usuarios, 4 clientes y 4 semanas de ventas de ejemplo
npm run dev:backend         # API en http://localhost:3000
```

Sin `--demo`, el seed carga solo los datos base (sin historial de ventas).

### La app

```bash
cd perupos/mobile
# La IP de tu computadora en la red WiFi (el celular debe poder verla):
EXPO_PUBLIC_API_URL=http://192.168.1.50:3000 npx expo start
```

Escanea el QR de la terminal con Expo Go. También puedes fijar la URL en
`mobile/app.json` → `expo.extra.apiUrl`.

### Usuarios de prueba

| Rol | Usuario | PIN |
| --- | --- | --- |
| Administrador | `admin` | `1234` |
| Vendedor | `carlos` | `1111` |
| Agente Financiero | `lucia` | `2222` |

**Cámbialos** en *Administrador → Usuarios* antes de usar la app en tu tienda (o define
`SEED_*_PIN` antes del seed). Tras 5 PIN equivocados el usuario se bloquea 5 minutos.

---

## 2. Variables de entorno (`backend/.env`)

| Variable | Para qué sirve |
| --- | --- |
| `DATABASE_URL` | Conexión a PostgreSQL |
| `JWT_SECRET` | Clave para firmar sesiones (mínimo 32 caracteres, aleatoria) |
| `BUSINESS_RUC`, `BUSINESS_RAZON_SOCIAL`, `BUSINESS_NOMBRE_COMERCIAL`, `BUSINESS_DIRECCION`, `BUSINESS_UBIGEO`, `BUSINESS_PHONE` | Datos del negocio que usa el seed. Luego se editan desde la app (*Mi negocio*). El RUC se valida con su dígito verificador |
| `BUSINESS_TAX_REGIME` | `NRUS`, `RER`, `RMT` o `GENERAL` |
| `PAYMENTS_PROVIDER` | `mock` (prueba, sin cobros reales) o `taypi` |
| `TAYPI_PUBLIC_KEY`, `TAYPI_SECRET_KEY` | Llaves de tu cuenta TAYPI (`taypi_pk_…`, `taypi_sk_…`) |
| `TAYPI_WEBHOOK_SECRET` | Secreto para verificar los webhooks de pago |
| `TAYPI_BASE_URL` | `https://sandbox.taypi.pe` (pruebas) o `https://app.taypi.pe` (producción) |
| `QR_TTL_SECONDS` | Tiempo para pagar el QR (120 = 2 minutos) |
| `MOCK_AUTOPAY_SECONDS` | Solo `mock`: el QR se paga solo tras N segundos (para demos) |
| `PSE_PROVIDER` | `mock` (simula a SUNAT), `nubefact` o `none` |
| `NUBEFACT_URL`, `NUBEFACT_TOKEN` | "RUTA" y "TOKEN" de la API de Nubefact |
| `PUSH_ENABLED`, `EXPO_ACCESS_TOKEN` | Notificaciones push con Expo |
| `ALERTS_INTERVAL_MINUTES` | Cada cuánto revisa el agente las alertas (15 por defecto) |

Las llaves de TAYPI y del PSE viven **solo en el servidor**; nunca se envían al celular.
En la app, el Administrador activa o desactiva el cobro con QR y ve si la integración
está conectada (*Mi negocio → Yape y Plin*).

### Yape y Plin con TAYPI

1. Crea tu cuenta en TAYPI y copia las llaves de **sandbox**.
2. Pon `PAYMENTS_PROVIDER=taypi` y las llaves en `.env`.
3. Registra el webhook en TAYPI: `https://TU-SERVIDOR/webhooks/taypi` y copia su secreto a
   `TAYPI_WEBHOOK_SECRET`. La firma (`Taypi-Signature: sha256=…`) se verifica sobre el
   cuerpo crudo.
4. Aunque el webhook no llegue, la app consulta el estado del pago cada 2.5 segundos.
5. Prueba en sandbox y recién después cambia `TAYPI_BASE_URL` a producción.

### Comprobantes con Nubefact

1. Activa la API en tu cuenta de Nubefact y copia la RUTA y el TOKEN.
2. Pon `PSE_PROVIDER=nubefact`, `NUBEFACT_URL` y `NUBEFACT_TOKEN`.
3. Las series por defecto son `B001` (boletas), `F001` (facturas) y `T001` (ticket POS).
   Deben coincidir con las que tienes en Nubefact.
4. Si SUNAT o el PSE no responden, el comprobante queda *pendiente* y se reintenta solo
   cada 2 minutos (hasta 8 veces; luego queda para revisión).

---

## 3. Guía rápida para el tendero (5 minutos)

**Entrar:** toca tu rol (Vendedor, Administrador o Agente), elige tu nombre y escribe tu
PIN en el teclado grande.

**Vender**
1. *Nueva Venta* → toca **Escanear** y apunta al código de barras. Cada producto que lee
   se suma solo al carrito (puedes escanear varios seguidos).
2. ¿No tiene código? Búscalo por nombre o tócalo en la cuadrícula. Filtra por categoría.
3. ¿El código no está registrado? La app te pide nombre, precio, categoría y una foto, y
   lo agrega a la venta.
4. Toca **Cobrar**.

**Cobrar (pago mixto)** — ejemplo: total S/ 50.00, el cliente da S/ 30 en efectivo y el resto por Yape.
1. En el primer método (Efectivo) escribe `30`.
2. Toca **+ Agregar otro método** y elige **Yape**: la app pone sola los S/ 20.00 que faltan.
3. En "¿Con cuánto paga?" toca el billete que te dio (ej. S/ 50): verás el **VUELTO** en grande.
4. Toca **Cobrar**: aparece un QR por S/ 20.00 que sirve para **Yape y Plin**. Tiene 2
   minutos; si vence, toca *Generar nuevo QR*.
5. Cuando el cliente paga, la venta se registra sola. Imprime o envía el ticket por WhatsApp.

**Fiado:** en Cobrar elige *Fiado* y el cliente (o créalo en el momento). Si el fiado supera
su límite, el Administrador escribe su PIN en tu celular para autorizarlo.

**Abono:** *Abono* → elige el cliente → escribe cuánto paga → Efectivo, Yape o Plin. Se
genera una constancia con el saldo que le queda.

**Deudas:** *Fiado → Por cobrar* ordena por monto o antigüedad. *Vencidos* muestra a
quienes llevan más de 30 días sin abonar. El botón verde envía un recordatorio por WhatsApp.

**Descuentos:** hasta 10 % los da el vendedor; más de 10 % necesita el PIN del Administrador.

**Caja:** ábrela en la mañana con tu sencillo, anota los retiros (pago a proveedores) y al
cerrar escribe cuánto contaste: la app te dice si falta o sobra plata.

**¿Se fue el internet?** La barra de arriba se pone **ámbar**. Sigue vendiendo: todo se
guarda en el celular y se envía solo al volver la señal ("3 por enviar"). Sin internet
no se genera el QR: si el cliente paga con el QR fijo de tu mostrador, confirma viendo
la notificación en tu Yape/Plin (queda marcado para revisar).

---

## 4. Roles y permisos

| Acción | Admin | Vendedor | Agente |
| --- | :-: | :-: | :-: |
| Vender, fiar, registrar abonos | ✅ | ✅ | — |
| Ver sus propias ventas | ✅ | ✅ | ✅ (todas) |
| Crear producto rápido desde la caja | ✅ | ✅ | — |
| Cambiar precios, stock, IGV | ✅ | — | — |
| Descuento > 10 %, fiado sobre el límite | ✅ | con PIN del Admin | — |
| Anular ventas | ✅ | — | — |
| Cambiar límite de crédito | ✅ | — | — |
| Usuarios, datos del negocio, cuentas bancarias, Yape/Plin | ✅ | — | — |
| Reportes financieros y SIRE | ✅ | — | ✅ (sin SIRE) |
| Tablero financiero, alertas, enviar recomendaciones | ✅ | ve sus alertas | ✅ |

Los permisos están en `shared/src/permissions.ts` y el servidor los aplica en cada ruta:
ocultar un botón en la app no es la única protección.

### Alertas automáticas (push)

| Alerta | Condición | Para |
| --- | --- | --- |
| Stock bajo | stock ≤ mínimo configurado | Admin + Vendedor |
| Límite de crédito | deuda ≥ 90 % del límite | Admin |
| Caja baja | efectivo en caja < S/ 50 (configurable) | Admin + Agente |
| Deuda vencida | más de 30 días sin abonar | Admin + Vendedor |
| Sin movimiento | producto sin ventas en 15 días | Admin |

Cada alerta se envía una sola vez y se cierra sola cuando deja de cumplirse (por ejemplo,
al reponer el stock). El Agente además recibe **recomendaciones** ("El arroz es tu producto
más vendido. Quedan 8 kg. Considera reponer 20 kg más.") y puede enviarlas como push al
Admin y al Vendedor.

Para recibir push en el celular necesitas un *development build* o una app publicada con
EAS (`npx eas-cli build --profile development`) y el `projectId` de EAS en `app.json`
(`expo.extra.eas.projectId`). Sin push, las alertas igual se ven dentro de la app.

---

## 5. Sin internet (offline-first)

| Funciona sin internet | Necesita internet |
| --- | --- |
| Vender (escáner, búsqueda, carrito) | Generar el QR de Yape/Plin |
| Cobrar en efectivo, tarjeta, transferencia, fiado | Autorización del Admin (PIN) |
| Yape/Plin confirmado a mano | Primer inicio de sesión |
| Crear clientes y productos (con foto) | Reportes, tablero, caja, SIRE |
| Registrar abonos | Editar precios y usuarios |
| Ver e imprimir el ticket | Número definitivo de boleta/factura |

Cada venta lleva un **id generado en el celular**: si se reenvía tras un corte, el servidor
no la duplica. Si el Admin cambió un precio mientras el celular estaba desconectado, se
acepta el precio anterior (hasta 30 días) y queda registrado en la auditoría.

---

## 6. Cumplimiento tributario

- **RUC** obligatorio y validado con su dígito verificador.
- **IGV 18 % incluido** en el precio: se extrae del total (base = total / 1.18). Productos
  exonerados (ej. papa fresca) o inafectos no llevan IGV.
- **Nuevo RUS:** no se discrimina IGV, no se emiten facturas; se emite **Ticket POS** (SEE-CF,
  R.S. 141-2017/SUNAT y modificatorias) o nota de venta.
- **RER, RMT y Régimen General:** boletas y facturas electrónicas vía PSE.
- Boletas mayores a **S/ 700** piden el DNI del comprador; facturas piden RUC válido.
- El ticket incluye RUC, razón social, dirección, número de comprobante, detalle, IGV,
  total, importe en letras, **desglose de pagos** ("Efectivo: S/ 30.00 / Yape: S/ 20.00"),
  vuelto y el **QR de SUNAT** que devuelve el PSE.
- **SIRE:** *Reportes → Exportar para SIRE* genera el archivo `.txt` (separado por `|`) de
  reemplazo de la propuesta del Registro de Ventas (RVIE) del mes.

---

## 7. Límites conocidos y lo que falta validar

Esto está implementado y probado con datos de prueba, pero **no** contra servicios reales:

- **TAYPI:** se usa su SDK oficial (`taypi.pe` 1.0.0). El SDK no tipa las respuestas, así
  que los campos del QR (`qr_string`/`qr_code`/`qr_image`…) y del webhook se leen de forma
  defensiva en `backend/src/services/payments/taypi.ts`. Prueba en sandbox y ajusta ahí si
  tu cuenta devuelve otros nombres.
- **Nubefact:** el JSON sigue el formato de su API (`generar_comprobante`,
  `consultar_comprobante`, `generar_anulacion`). Verifica en su entorno de pruebas antes de
  producción, sobre todo boletas "clientes varios" y ventas a granel.
- **Ticket POS (Nuevo RUS):** requiere un PSE autorizado para el SEE-CF. El adaptador de
  Nubefact no lo emite; la venta queda pendiente hasta conectar ese proveedor
  (`backend/src/services/pse/provider.ts`).
- **SIRE:** la estructura de columnas y el nombre del archivo siguen el anexo de reemplazo
  del RVIE vigente al escribir esto. Pásalo por el validador de SUNAT o revísalo con tu
  contador antes de subirlo.
- **No modelados:** IVAP del arroz pilado, ICBPER (bolsas plásticas), notas de crédito.
- **Impresión:** usa el diálogo de impresión del sistema (`expo-print`) y PDF. Las
  ticketeras Bluetooth ESC/POS necesitan una librería nativa adicional.
- **Imágenes:** PeruFoodNet (4,000 fotos de 40 platos típicos, Mendeley Data
  `10.17632/hxhbbm497d`) solo sirve para **platos preparados** (menú, ceviche, lomo
  saltado). Para abarrotes envasados se usa la foto que toma el vendedor. Para cargarlo:
  ```bash
  npm run perufoodnet:import -w @perupos/backend -- --dir /ruta/PeruFoodNet --create
  ```
  Revisa la licencia del dataset antes de usar sus fotos comercialmente.
- La afectación al IGV de cada producto la define el Admin: confírmala con tu contador.

---

## 8. Desarrollo

```bash
npm test             # reglas compartidas + API contra PostgreSQL (base perupos_test)
npm run typecheck    # shared, backend y app
npm run bundle -w @perupos/mobile   # compila el bundle Android con Metro
```

Los tests del backend usan `TEST_DATABASE_URL` (por defecto
`postgres://perupos:perupos@localhost:5432/perupos_test`) y **borran esa base** en cada
corrida. El workflow `.github/workflows/perupos.yml` los corre en cada cambio.

### API (resumen)

| Método y ruta | Uso |
| --- | --- |
| `POST /auth/login`, `/auth/refresh`, `/auth/authorize`, `/auth/push-token` | Sesión, autorización del Admin, push |
| `GET /sync/pull?since=` · `POST /sync/push` | Sincronización offline (catálogo, clientes, ventas, abonos) |
| `GET/POST /products`, `PATCH /products/:id`, `POST /products/:id/image`, `/restock` | Catálogo |
| `POST /sales`, `GET /sales`, `GET /sales/:id/receipt`, `POST /sales/:id/void` | Ventas |
| `POST /payments/qr`, `GET /payments/qr/:id`, `POST /payments/qr/:id/cancel` | QR Yape/Plin |
| `POST /webhooks/taypi` | Confirmación de pago de TAYPI |
| `GET/POST/PATCH /customers`, `POST /abonos` | Fiado y abonos |
| `GET /cash/current`, `POST /cash/open`, `/cash/movements`, `/cash/close` | Caja |
| `GET /agent/dashboard`, `/reports/*`, `/reports/sire?period=AAAAMM` | Reportes y SIRE |
| `GET /alerts`, `POST /alerts/evaluate`, `POST/GET /notifications` | Alertas y mensajes |
| `GET/PUT /settings`, `/users`, `/bank-accounts`, `/doc-series` | Administración |
