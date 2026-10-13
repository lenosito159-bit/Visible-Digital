# Módulo de servidor de PeruPOS (opcional)

**La app del celular no usa este servidor.** Funciona sola, sin internet ni RUC (ver
`../README.md`). Este backend queda como módulo opcional para el futuro, con sus
integraciones y sus tests (que corren en CI):

- API Express + PostgreSQL (ventas, fiados, caja, usuarios con roles, sincronización).
- **TAYPI**: cobro con QR interoperable y Yape/Plin **verificado** por webhook.
- **Nubefact** (PSE): boletas y facturas electrónicas de SUNAT.
- **Padrón reducido del RUC** de SUNAT y exportación **SIRE**.
- Notificaciones push de Expo y alertas del "Agente Financiero".

El cliente del celular que hablaba con este servidor está separado en
`../mobile/modulo-servidor/` (no se compila ni va en el APK). Su README explica qué haría
falta para volver a conectarlos: no es solo copiar archivos, porque ahora los datos viven en
el celular.

Pruebas del módulo: `npm test -w @perupos/backend` (necesita PostgreSQL) y, con el servidor
corriendo y una base de prueba, `npm run test:flujos -- --base-de-prueba` y la guía
`../scripts/smoke-test.md`.

## Instalación del servidor

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


## Variables de entorno (`backend/.env`)

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

Las llaves de TAYPI y del PSE viven **solo en el servidor**; nunca se envían al celular.

### Scripts útiles (desde `perupos/`)

| Comando | Qué hace |
| --- | --- |
| `npm run taypi:check -w @perupos/backend` | Cobro de S/ 1.00 en el sandbox de TAYPI: muestra la respuesta cruda y lo anula |
| `npm run pse:check -w @perupos/backend -- --serie BBB1 --numero 1 [--dry-run]` | Boleta de prueba a Nubefact (demo) |
| `npm run padron:import -w @perupos/backend -- --file padron_reducido_ruc.txt` | Carga el Padrón Reducido de SUNAT para verificar RUC |
| `npm run perufoodnet:import -w @perupos/backend -- --dir /ruta --create` | Fotos de platos preparados (ver §5) |

---

## Qué falta antes de usarlo con dinero real

En orden. Detalle y estado de cada punto en [`QA.md`](QA.md).

1. Volver a conectar un cliente en el celular (ver `../mobile/modulo-servidor/README.md`) y
   probarlo con [`../scripts/smoke-test.md`](../scripts/smoke-test.md).
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
