# Cambios de PeruPOS

## 2026-09-30 — Pasada de adaptación a bodega peruana

Rama `claude/bold-ride-0su48m`. Un commit por bloque.

### Bloque 1 — Build de Android
- `mobile/eas.json` con perfiles `development` (dev client, APK), `preview` (APK) y
  `production` (AAB con `autoIncrement`).
- `mobile/app.config.ts`: Android permite `http://` (sin HTTPS) en `development` y `preview`
  para probar contra la PC por IP local; en `production` lo bloquea. Sin esto, un APK de
  prueba no se podía conectar al servidor local.
- `app.json`: versión 1.0.0, `versionCode` 1, `buildNumber` 1, `runtimeVersion`, `expo-dev-client`.
- Íconos propios (toldo de bodega + "S/") en lugar de los de ejemplo de Expo.
- `scripts/smoke-test.md`: 15 pasos con casos reales de bodega.
- `QA.md`: instalación del APK paso a paso y dónde va el `projectId`.

### Bloque 2 — Flujos de bodega
- El "resto" se asigna al último método agregado (antes solo funcionaba con 2 métodos).
- **Nuevo:** Yape/Plin pagado de más con vuelto en efectivo; la caja descuenta ese vuelto.
- **Nuevo:** N° de operación en Yape/Plin confirmado a mano, sin repetirse entre ventas ni abonos.
- **Nuevo:** trato Don/Doña (lo elige el tendero) y marca "Siempre paga" / "Le cuesta pagar".
- **Nuevo:** plantillas de WhatsApp (amable, quincena, fin de mes, segundo aviso) con fecha en
  palabras ("12 de setiembre"), vista previa y aviso de quincena / fin de mes.
- **Nuevo:** cierre de caja con desglose por método, vuelto de yapeos, yapeo al administrador
  para cuadrar y resumen por WhatsApp. `GET /cash/closures` para revisar cierres.
- Mensajes de error y de conexión en palabras de bodega.
- Ya existían y ahora tienen tests explícitos: fiado parcial, pago triple, vuelto cuando el
  efectivo excede su parte, QR pagado con Plin, abono por Plin, reuso de pagos.

### Bloque 3 — Padrón SUNAT, push y rendimiento
- **Nuevo:** tabla `sunat_padron` e importador del Padrón Reducido del RUC; `GET /ruc/:ruc`.
  La app valida el RUC al emitir factura y llena la razón social. Sin padrón: "no verificado".
- Un canal de Android por cada alerta + mensajes del agente.
- Catálogo por páginas de 60, búsqueda con espera de 250 ms, listas virtualizadas, guardado
  local con sentencia preparada, fotos en caché, compresión gzip en el servidor.

### Bloque 4 — Integraciones
- TAYPI: registro de la respuesta cruda de la primera llamada de cada tipo; `TAYPI_DEBUG`.
- **Nuevo:** `POST /webhooks/taypi/test` (solo Admin, apagado en producción): webhook firmado
  simulado por el mismo camino que el real. (Se pidió como `/webhook/taypi/test`; se dejó en
  `/webhooks/…` para seguir la ruta del webhook real.)
- **Nuevo:** `npm run taypi:check` y `npm run pse:check`.
- **Corregido:** nombre del archivo del SIRE (posiciones 30 y 31 estaban al revés; un mes sin
  ventas daba un nombre incorrecto).
- **Corregido:** una variable vacía en el `.env` (p. ej. `TAYPI_TEST_ENDPOINT=`) impedía arrancar.

### Bloque 5 — Documentación
- `QA.md` con el estado real de cada sección (A–F), `README.md` con la guía de uso en bodega
  y lo que falta antes de usar dinero real, y este archivo.

### Tests
- shared: 23 → 31 · backend: 32 → 48 (nuevos: `bodega.test.ts`, `padron.test.ts`, push).

### Migraciones nuevas
- `002_bodega.sql`: `customers.trato`, `customers.reputation`, `cash_sessions.transferred_cents`,
  `credit_movements.reference`, tabla `operation_refs`.
- `003_padron_sunat.sql`: tabla `sunat_padron`.

## 2026-09-30 — Primera versión
- Backend, app y reglas compartidas; ver el historial de git.
