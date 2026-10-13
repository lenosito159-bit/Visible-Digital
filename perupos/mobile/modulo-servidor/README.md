# Módulo de servidor del celular (separado, no se usa)

Estos archivos son la parte de la app que hablaba con el backend (`perupos/backend`) en la
versión anterior: inicio de sesión con usuario, sincronización con cola de envíos, cobro con
QR de TAYPI, notificaciones push de Expo, pantalla del Agente Financiero, configuración con
RUC/régimen/cuentas y exportación SIRE.

**No están conectados a la app.** Están fuera de `src/`, así que no se compilan, no se
revisan con TypeScript y no van dentro del APK. La app funciona completa en el celular sin
ellos (ver `perupos/REDISENO.md`).

| Archivo | Qué hacía |
|---|---|
| `lib/api.ts` | Cliente HTTP con sesión (JWT) y renovación de token |
| `lib/sync.ts` | Cola de envíos (outbox) y descarga del catálogo (`/sync/push`, `/sync/pull`) |
| `lib/push.ts` | Registro del token de notificaciones push de Expo |
| `lib/sale.ts` | Ticket con RUC/SUNAT y QR del comprobante electrónico |
| `lib/mode.ts` | Interruptor `EXPO_PUBLIC_SERVER_ENABLED` |
| `components/QrPaymentModal.tsx` | Cobro con QR interoperable de TAYPI (Yape/Plin verificado) |
| `components/ServerSettings.tsx` | RUC, régimen tributario, cuentas bancarias |
| `components/ConnectionBar.tsx` | Barra "En línea / sin señal / por enviar" |
| `pantallas/login.tsx` | Inicio de sesión con usuario y PIN del servidor |
| `pantallas/agente/*` | Tablero y recomendaciones del Agente Financiero |

## Qué haría falta para volver a usar un servidor

No basta con volver a copiar estos archivos: fueron hechos cuando el servidor era la fuente
de la verdad. Ahora la verdad está en el celular. Para un servidor opcional habría que:

1. Diseñar la sincronización desde el celular hacia el servidor (copia en la nube o varios
   celulares), con permiso explícito del comerciante: nada se envía solo.
2. Adaptar `lib/sync.ts` para leer de las tablas locales (`shared/src/local`) en vez de la
   cola antigua.
3. Para Yape **verificado** con TAYPI: el servidor es obligatorio (la llave secreta y el
   webhook no pueden ir en el APK). El pago verificado debe guardarse distinto del
   "confirmado manualmente por el comerciante".
4. Para comprobantes de SUNAT (Nubefact) y SIRE: solo para negocios con RUC que lo pidan.

El backend sigue completo y con sus tests en `perupos/backend` (ver su sección en el README).
