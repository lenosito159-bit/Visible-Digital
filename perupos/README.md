# PeruPOS

Herramienta para que el pequeño comerciante peruano (bodega, puesto, minimarket, negocio que
recién empieza) organice su negocio **desde su celular**: ventas, productos e inventario, caja,
fiados y abonos, tickets e informes. **Sin RUC, sin registro de empresa, sin internet y sin
servidor.**

> **Estado: en prueba.** Compila y pasan los tests, pero todavía **no se probó en un Android
> real**. No la uses en una tienda con datos reales hasta completar [`PRUEBA-APK.md`](PRUEBA-APK.md),
> incluida la recuperación de una copia de seguridad en un celular recién instalado.

## Qué hace

- **Primera vez:** nombre del negocio, tu nombre y un PIN. Nada más (el celular es opcional).
  Un código de recuperación de 10 números por si olvidas el PIN.
- **Productos e inventario:** el catálogo empieza vacío. Cada producto con precio, stock,
  "avisar cuando queden" y foto/código de barras opcionales. "Llegó mercadería", "Conté el
  anaquel" e historial de movimientos.
- **Ventas** con pagos mezclados: efectivo con vuelto, Yape, Plin, tarjeta, transferencia y
  fiado. "Te yapeo 40, dame el vuelto" funciona.
- **Yape y Plin:** el comerciante revisa **su** app de Yape/Plin y confirma aquí que le llegó.
  Queda como **"Confirmado manualmente por el comerciante"**. La app **no** verifica pagos por
  su cuenta y nunca muestra un pago como verificado.
- **Fiados y abonos:** límite por cliente, cuaderno, constancia con el saldo, recordatorio por
  WhatsApp (lo envía el comerciante).
- **Caja:** apertura, ingresos y retiros, cierre con lo contado. Descuenta el vuelto de los yapeos.
- **Ticket:** "COMPROBANTE INTERNO" con total, cómo pagó, vuelto y lo fiado. Termina con
  "Comprobante interno del negocio. No es boleta ni factura." Sin RUC ni datos de SUNAT.
- **Informes:** hoy, ayer, 7 días, este mes, mes pasado; formas de pago, ganancia aproximada,
  lo más vendido.
- **Avisos:** stock bajo, fiado vencido, límite de fiado, poco sencillo, productos que no se
  venden. Notificación del propio celular (solo mientras se usa la app).
- **Ayudantes** con su propio PIN y menos permisos (un solo celular por negocio).
- **Copia de seguridad con contraseña** y recuperación desde archivo (ver abajo).
- **Modo demostración** aparte, con 20 productos de ejemplo, que se borra entero.

## Qué NO hace (a propósito)

- No emite boletas ni facturas de SUNAT, no pide RUC ni régimen tributario.
- No verifica Yape/Plin automáticamente (eso necesita internet y una integración con servidor).
- No envía datos a nadie por su cuenta. Lo único que sale del celular es lo que el comerciante
  comparte con el menú de compartir (ticket por WhatsApp, copia de seguridad).
- No sincroniza varios celulares: **un celular por negocio**.

## Copia de seguridad

- **Hacer la copia** (Mi negocio → Copia de seguridad): se pide una **contraseña** (mínimo 8
  caracteres) y se arma un archivo con todo el negocio y las fotos, **cifrado** con esa
  contraseña. Se abre el menú de compartir para guardarlo **fuera** del celular (WhatsApp a uno
  mismo, Drive, correo).
- **Comprobar**: la app no sabe si el archivo se guardó solo porque se abrió el menú. Por eso
  pide abrir la copia guardada con su contraseña; recién ahí la marca como **comprobada**. El
  inicio del dueño recuerda hacerla y comprobarla (si nunca se hizo o si pasó una semana).
- **Recuperar**: en un celular nuevo, primera pantalla → "Recuperar mi negocio desde una copia"
  (o en Mi negocio). Se elige el archivo, se ve de qué negocio y fecha es, se pone la
  contraseña y se confirma. Se entra con el PIN que había al hacer la copia.
- **Si olvidas la contraseña de una copia, esa copia no se puede abrir de ninguna forma**
  (ni con el código de recuperación del PIN, ni por nosotros). Mientras tengas el celular,
  haz una copia nueva con una contraseña nueva. Anota la contraseña en papel junto al código
  de recuperación.
- **Protecciones:** el archivo cifrado (XChaCha20-Poly1305, clave con PBKDF2-SHA256 de 150 000
  vueltas) no se puede leer sin la contraseña y cualquier cambio se detecta. A la vista solo
  quedan el nombre del negocio y la fecha. Recuperar es todo o nada: si falla, el celular queda
  como estaba.

## Estructura

```
perupos/
├── shared/                Lógica y tipos en TypeScript puro
│   ├── src/local/         ← la app: base SQLite del celular (migraciones, ventas, caja,
│   │                        fiados, informes, avisos, copia cifrada, ticket interno)
│   └── test/              tests de la lógica local sobre el SQLite de Node
├── mobile/                App Expo (Android)
│   ├── src/               pantallas y conexión con expo-sqlite / archivos / notificaciones
│   └── modulo-servidor/   cliente del servidor anterior, separado (no va en el APK)
├── backend/               Módulo de servidor opcional (no lo usa la app) — ver backend/README.md
├── PRUEBA-APK.md          Cómo construir el APK y probarlo en un Android
├── REDISENO.md            Reglas del rediseño y qué hay en cada etapa
├── QA.md                  Estado de las pruebas
└── CHANGELOG.md
```

## Desarrollo

```bash
cd perupos
npm ci                 # instala y compila shared
npm run typecheck      # shared, backend y mobile
npm test               # shared (lógica del celular) + backend (necesita PostgreSQL)
npm test -w @perupos/shared   # solo la lógica del celular, sin PostgreSQL
cd mobile && npx expo export --platform android --output-dir /tmp/bundle   # que el bundle arme
```

- Los tests de `shared` usan el SQLite que trae Node (el mismo motor que `expo-sqlite`), pero
  **no corren en un celular**.
- APK para probar: ver [`PRUEBA-APK.md`](PRUEBA-APK.md) (`eas build --profile preview`).
- El APK solo pide cámara (códigos de barras, fotos) y notificaciones; el micrófono está bloqueado.

## Limitaciones conocidas (con honestidad)

- Nada se probó todavía en un Android real: ni las pantallas, ni el menú de compartir, ni el
  selector de archivos, ni las notificaciones, ni cuánto tarda cifrar la copia.
- Con la app cerrada no llegan avisos (no hay tarea en segundo plano).
- El PIN protege contra quien agarra el celular, no contra quien saca el archivo de la base
  (un PIN de 4–6 números se puede adivinar probando todos).
- PBKDF2 con 150 000 vueltas es menos de lo recomendado para servidores; se eligió para que un
  celular de gama baja no tarde demasiado. Una contraseña larga (una frase) compensa.
- Categorías de productos: el catálogo funciona sin ellas; no hay pantalla para crearlas.
