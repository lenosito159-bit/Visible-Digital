# Checklist de QA antes de merge

Estado al 30/09/2026. Leyenda: ✅ verificado · 🟡 hecho pero sin probar en el mundo real ·
⬜ pendiente · ❌ no implementado.

Los comandos se ejecutan desde `perupos/` con **npm** (el proyecto usa `package-lock.json`).

| Sección | Estado | Quién lo verificó |
| --- | --- | --- |
| A. Compilación y tests | ✅ | Claude, en el entorno de desarrollo |
| B. Celular real | ⬜ | Nadie todavía: falta el APK |
| C. TAYPI y Nubefact reales | 🟡 | Solo con proveedores de prueba (sin credenciales) |
| D. Cumplimiento fiscal | 🟡 / ❌ | Parcial; falta el contador |
| E. Push | 🟡 | Lógica probada; envío real no |
| F. Pendientes | ⬜ / ❌ | — |

---

## A. Compilación y tests ✅

Verificado desde `npm ci` limpio, contra PostgreSQL 16.

- [x] `npm run typecheck` — shared, backend y mobile sin errores
- [x] `npm test -w @perupos/shared` — **31/31**
- [x] `npm test -w @perupos/backend` — **48/48** contra PostgreSQL real
      (usa `TEST_DATABASE_URL`, por defecto `perupos_test`, y **la borra** en cada corrida)
- [x] `npx expo export --platform android` (en `mobile/`) — 1772 módulos, sin warnings
- [x] Plugins de `app.json` y `app.config.ts` resuelven (`npx expo config --type introspect`).
      Android: CAMERA, INTERNET, VIBRATE, almacenamiento; **sin micrófono**. iOS: textos en español.
- [x] `usesCleartextTraffic`: permitido en `development`/`preview`, bloqueado en `production`
      (verificado con `EAS_BUILD_PROFILE=preview` y `=production`)
- [x] `backend/.env.example` copiado tal cual arranca la configuración sin errores

Qué cubren los tests (y qué no): ver la tabla al final.

### Nota de CI (30/09/2026): no hay test flaky

En el PR #2 aparecen **dos checks llamados "test"**. No es el mismo test corriendo dos veces:
son dos workflows distintos sobre el mismo commit.

| Workflow | Archivo | Qué corre | Duración típica |
| --- | --- | --- | --- |
| API tests | `.github/workflows/api-tests.yml` | Tests del catálogo de APIs (raíz del repo), no de PeruPOS | ~15 s |
| PeruPOS | `.github/workflows/perupos.yml` | `npm ci` + PostgreSQL + typecheck + 79 tests | ~1 min |

Cuando uno aparece "en curso" y el otro ya pasó, es solo que PeruPOS tarda más. En el commit
`2703151` ambos terminaron en verde, y la suite completa pasó **5 de 5 veces seguidas** en local.
No se saltó ningún test.

Riesgo conocido (no es flakiness hoy): dentro de cada archivo de `backend/test/`, los casos
comparten la base de datos y **dependen del orden** (por ejemplo, el cierre de caja suma las
ventas de los casos anteriores). Vitest los corre en orden fijo y los archivos uno tras otro
(`fileParallelism: false`). No activar `--sequence.shuffle` ni paralelismo sin antes aislar
cada caso con su propia base.

## Cómo instalar el APK en un Android (paso a paso)

Necesitas una cuenta gratuita en [expo.dev](https://expo.dev). El build se hace en la nube
de Expo: no necesitas Android Studio.

1. **Servidor accesible desde el celular.** En tu computadora, desde `perupos/`:
   `npm run db:seed -- --demo` y `npm run dev:backend`. Averigua la IP de tu computadora en la
   WiFi (Windows: `ipconfig`; Mac/Linux: `ip addr` o Preferencias de red), por ejemplo
   `192.168.1.50`. Si el firewall pregunta, permite el puerto 3000.
2. **Pon esa IP** en `mobile/eas.json`, perfiles `development` y `preview`:
   `"EXPO_PUBLIC_API_URL": "http://192.168.1.50:3000"`.
3. **Vincula el proyecto** (una sola vez), desde `perupos/mobile`:
   ```bash
   npx eas-cli@latest login
   npx eas-cli@latest init
   ```
   `eas init` crea el proyecto en expo.dev y te da un **projectId**. Como la app usa
   `app.config.ts`, puede que no pueda escribirlo solo: en ese caso ábrelo en `app.json` y
   agrégalo dentro de `"expo"` así:
   `"extra": { "apiUrl": "...", "eas": { "projectId": "EL-ID-QUE-TE-DIO" } }`.
   Sin projectId, el build no arranca y las notificaciones push no llegan.
4. **Construye el APK:**
   ```bash
   npx eas-cli@latest build --platform android --profile preview
   ```
   Tarda ~15–25 minutos en la cola gratuita. Al terminar muestra un **enlace y un QR**.
5. **Instálalo:** abre el enlace en el celular → descarga el `.apk` → Android pedirá permitir
   "Instalar apps desconocidas" para el navegador → **Instalar**. Play Protect puede avisar que
   la app no es conocida: toca *Más detalles → Instalar de todos modos*.
6. Abre **PeruPOS** y sigue [`scripts/smoke-test.md`](scripts/smoke-test.md) (15 pasos).

**Perfiles** (`mobile/eas.json`):

| Perfil | Para qué | Salida | http sin HTTPS |
| --- | --- | --- | --- |
| `development` | Desarrollar con recarga en vivo (`npx expo start --dev-client`) y probar push | APK | permitido |
| `preview` | Probar en la tienda como la usará el vendedor | APK | permitido |
| `production` | Google Play | AAB | **bloqueado**: el servidor debe tener HTTPS |

Nunca se generó un APK desde este entorno: los pasos 3–5 necesitan tu cuenta de Expo.

## B. Prueba en dispositivo real ⬜ (bloqueante para uso en tienda)

Seguir [`scripts/smoke-test.md`](scripts/smoke-test.md). Resumen:

- [ ] APK instalado en un Android físico de gama baja (Redmi 9A / Samsung A0x)
- [ ] Login con los 3 roles y permisos
- [ ] Escáner con un código de barras real
- [ ] Efectivo con vuelto (paga con S/ 50 una cuenta de S/ 32)
- [ ] Mixta S/ 20 efectivo + S/ 30 Yape
- [ ] Mixta S/ 15 efectivo + S/ 25 Plin
- [ ] Triple S/ 10 efectivo + S/ 20 Yape + S/ 20 fiado
- [ ] Fiado total a cliente nuevo + autorización al pasar el límite
- [ ] Abono parcial con Yape
- [ ] "Te yapeo 40, dame el vuelto" y N° de operación repetido rechazado
- [ ] Modo avión + 2 ventas + reconexión sin duplicados
- [ ] Recordatorio por WhatsApp y marca "siempre paga / le cuesta pagar"
- [ ] Cierre de caja con desglose y yapeo al administrador
- [ ] Fluidez con 2 GB de RAM y lectura al sol

Ya cubierto por tests del servidor (falta verlo en el celular): todos los montos, vueltos y
saldos de la lista anterior, reenvío de ventas sin duplicar, permisos por rol.
**Nada de la interfaz** (pantallas, cámara, SQLite local, modo avión) se probó en un celular.

## C. Integraciones externas 🟡 (bloqueante antes de dinero real)

Ninguna se probó contra el servicio real: no hay credenciales en el entorno de desarrollo.

- [ ] TAYPI sandbox: `npm run taypi:check -w @perupos/backend` con tus llaves. Revisa en el log
      `[TAYPI] respuesta cruda de createPayment` que el QR se haya detectado
      (`hasQrPayload` o `hasQrImage` en true). Si no, ajusta `pick()` en
      `backend/src/services/payments/taypi.ts`.
- [ ] TAYPI sandbox: pagar el QR con la app de prueba y ver llegar el webhook
      (`[TAYPI] respuesta cruda de webhook`). El formato del webhook es un **supuesto**: el SDK
      solo documenta la firma (`Taypi-Signature: sha256=…`), no el cuerpo.
- [ ] TAYPI: pagar con **Plin** y verificar que se anote Plin. Depende de que TAYPI informe la
      billetera en la respuesta o el webhook; si no lo hace, se anota el método que eligió el
      vendedor.
- [x] Reuso del mismo pago rechazado (venta→venta, venta→abono, abono→abono, N° de operación
      manual) — probado con el proveedor de prueba y con un webhook firmado simulado
- [x] Webhook firmado → cobro pagado → venta, por el mismo camino que el real
      (`POST /webhooks/taypi/test`, test `webhook de TAYPI (firmado) sin escanear`)
- [ ] Nubefact demo: `npm run pse:check -w @perupos/backend -- --serie BBB1 --numero 1`
      y comparar con el ticket de la app
- [ ] Nubefact: factura de prueba con RUC real y campos obligatorios
- [ ] Ticket POS (Nuevo RUS): **NO VALIDADO — proveedor SEE-CF no conectado**

## D. Cumplimiento fiscal 🟡 / ❌

- [ ] Confirmar régimen tributario con el contador (NRUS / RER / RMT / General)
- [ ] SIRE: subir el archivo en modo de prueba o revisarlo con el contador.
      El **nombre** del archivo se corrigió según la estructura publicada
      (`LE…0014040002OIM2`). Las **columnas** no se pudieron contrastar con el Anexo 3 vigente
      (el sitio de SUNAT está bloqueado desde el entorno de desarrollo).
- [ ] IVAP arroz pilado → **❌ NO IMPLEMENTADO**
- [ ] ICBPER bolsas plásticas → **❌ NO IMPLEMENTADO**
- [x] RUC contra el padrón de SUNAT: implementado con una **copia local** del Padrón Reducido
      (`npm run padron:import -w @perupos/backend -- --file padron_reducido_ruc.txt`).
      Probado con líneas en el formato publicado, **no con el archivo real** (varios GB, no se pudo
      descargar aquí). Sin padrón cargado, la app dice "no verificado contra el padrón".
      No hay consulta en línea: SUNAT no ofrece una API pública gratuita para esto.
- [x] Boletas > S/ 700 exigen DNI (test); falta verlo en el celular
- [ ] Afectación al IGV de cada producto (gravado / exonerado) confirmada por el contador

## E. Alertas del Agente Financiero 🟡

- [ ] Development build con EAS y `projectId` en `app.json`
- [ ] Recibir las 5 alertas push: stock bajo, límite de fiado, caja baja, fiado vencido, sin movimiento
- [ ] Recomendaciones enviadas a Admin y Vendedor llegan como push
- [x] Cada alerta sale por su propio canal de Android (`stock-bajo`, `limite-fiado`, `caja-baja`,
      `deudas-vencidas`, `sin-movimiento`) y los mensajes del agente por `mensajes` (test)
- [x] Apertura y cierre automático de alertas (test)

## F. Pendientes conocidos

- [ ] ❌ Notas de crédito
- [ ] ❌ Ticketeras Bluetooth (por ahora: diálogo de impresión del sistema o PDF)
- [ ] Rendimiento con > 500 productos **en el celular**. Hecho: catálogo por páginas de 60,
      búsqueda con espera, listas virtualizadas, guardado con sentencia preparada, fotos en
      caché y compresión gzip (con 1,020 productos la descarga baja de 289 KB a 35 KB).
      Falta medirlo en un celular de 2 GB de RAM.

---

## Qué prueban los tests automáticos

| Caso de bodega | Test |
| --- | --- |
| Efectivo 20 + Yape 30 con vuelto correcto | `bodega.test.ts` · vuelto es 10, no 30 |
| Fiado parcial (80 = 30 efectivo + 50 fiado) | `bodega.test.ts` · fiado parcial |
| Triple efectivo + Yape + fiado | `bodega.test.ts` · triple |
| Yapeó de más con vuelto en efectivo | `bodega.test.ts` · yapeo de 40 |
| QR pagado con Plin → se anota Plin | `bodega.test.ts` + `api.test.ts` |
| Abono con Plin y constancia de saldo | `bodega.test.ts` · abono parcial |
| Mismo pago usado dos veces | `bodega.test.ts` · 3 casos |
| Cierre de caja con desglose y yapeo al admin | `bodega.test.ts` · cierre |
| Don/Doña y "siempre paga" | `bodega.test.ts` · clientes |
| Plantillas de WhatsApp y "setiembre" | `shared.test.ts` |
| Reparto del resto con 2 y 3 métodos | `shared.test.ts` · rebalance |
| Venta sin señal reenviada sin duplicar | `api.test.ts` · sincronización offline |
| Padrón SUNAT (activo, baja, no encontrado, sin padrón) | `padron.test.ts` |

Lo que ningún test cubre: la interfaz de la app, la cámara, SQLite en el celular, el modo avión
real, la impresión, WhatsApp, el push real, TAYPI real, Nubefact real y SUNAT.
