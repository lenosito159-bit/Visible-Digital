# Checklist de QA antes de merge

Los comandos se ejecutan desde `perupos/` con **npm** (el proyecto usa `package-lock.json`).

## A. Compilación y tests (verificado el 30/09/2026 desde `npm ci` limpio)

- [x] `npm run typecheck` pasa en los 3 paquetes (shared, backend, mobile)
- [x] `npm test -w @perupos/shared` → 23/23 verdes
- [x] `npm test -w @perupos/backend` → 32/32 verdes contra PostgreSQL 16 real
      (usa `TEST_DATABASE_URL`, por defecto la base `perupos_test`, y la **borra** en cada corrida)
- [x] `npx expo export --platform android` (en `mobile/`) compila: 1772 módulos, sin warnings
- [x] Plugins de `app.json` resuelven (`npx expo config --type introspect`): cámara, SQLite,
      SecureStore, image picker, notificaciones, splash. Permisos finales de Android: CAMERA,
      INTERNET, VIBRATE, almacenamiento; **sin micrófono** (RECORD_AUDIO se quita explícitamente).
      Textos de permisos de iOS en español.

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
6. Abre **PeruPOS** y sigue [`scripts/smoke-test.md`](scripts/smoke-test.md).

**Perfiles** (`mobile/eas.json`):

| Perfil | Para qué | Salida | http sin HTTPS |
| --- | --- | --- | --- |
| `development` | Desarrollar con recarga en vivo (`npx expo start --dev-client`) y probar push | APK | permitido |
| `preview` | Probar en la tienda como la usará el vendedor | APK | permitido |
| `production` | Google Play | AAB | **bloqueado**: el servidor debe tener HTTPS |

## B. Prueba en dispositivo real (bloqueante para uso en tienda)

- [ ] Instalar APK en un Android físico (no solo emulador): `npx eas-cli build -p android --profile preview`
- [ ] Login con los 3 roles (Admin, Vendedor, Agente) y verificar permisos
- [ ] Escanear un código de barras real con la cámara trasera
- [ ] Venta 1: efectivo simple → ticket generado
- [ ] Venta 2: mixta (efectivo + QR) → verificar cálculo de vuelto y QR de 2 min
- [ ] Venta 3: fiado a cliente nuevo → verificar límite de crédito
- [ ] Abono a cliente con deuda → verificar descuento del saldo
- [ ] Modo avión → 2 ventas → reactivar red → verificar sync sin duplicados
- [ ] Barra superior: indicador de conexión + contador de pendientes

Ya cubierto por tests del servidor (falta verlo en el celular): cálculo de vuelto e IGV,
bloqueo del fiado sobre el límite y autorización del Admin, saldo tras el abono, reenvío
de ventas sin duplicar ni descontar stock dos veces, permisos por rol.

## C. Integraciones externas (bloqueante antes de dinero real)

- [ ] TAYPI sandbox: generar QR, pagar con Yape de prueba, confirmar webhook
- [ ] TAYPI sandbox: pagar el mismo tipo de QR con Plin → se registra como Plin
      (depende de que TAYPI informe la billetera en la respuesta o el webhook)
- [ ] TAYPI sandbox: intentar reusar el mismo pago → debe rechazarse (probado solo con el proveedor de prueba)
- [ ] Nubefact: boleta de prueba → comparar con el ticket de la app
- [ ] Nubefact: factura de prueba → validar campos obligatorios SUNAT
- [ ] Ticket POS NRUS: **NO VALIDADO — proveedor SEE-CF no conectado**

## D. Cumplimiento fiscal (bloqueante según régimen)

- [ ] Confirmar régimen tributario con el contador (NRUS / RER / RMT / General)
- [ ] Validar export SIRE con el validador oficial de SUNAT
- [ ] IVAP arroz pilado → **NO IMPLEMENTADO**
- [ ] ICBPER bolsas plásticas → **NO IMPLEMENTADO**
- [ ] RUC contra el padrón de SUNAT → **NO IMPLEMENTADO**: hoy solo se valida el formato y
      el dígito verificador. Un RUC bien formado pero inexistente o dado de baja pasa.
- [x] Umbral de DNI en boletas > S/ 700 (test `exige RUC válido para factura y DNI para boletas > S/ 700`);
      falta verlo en el celular

## E. Alertas del Agente Financiero

- [ ] Development build con EAS y `expo.extra.eas.projectId` en `app.json`
- [ ] Recibir las 5 alertas push: stock bajo, límite de crédito, caja baja, deuda vencida, sin movimiento
      (la lógica de apertura y cierre está probada en el servidor; el envío push real no)
- [ ] Recomendaciones enviadas a Admin y Vendedor llegan como push

## F. Pendientes conocidos (post-merge)

- [ ] Notas de crédito
- [ ] Ticketeras Bluetooth (por ahora: diálogo del sistema o PDF)
- [ ] Rendimiento con > 500 productos **en el celular**. Medido en el servidor con 1,020
      productos: la descarga inicial (`/sync/pull`) responde en ~20 ms y pesa ~290 KB sin
      comprimir; la búsqueda, ~7 ms. Falta medir en un Android de gama baja la primera
      carga en SQLite y el scroll de la cuadrícula.
