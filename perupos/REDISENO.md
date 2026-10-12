# Rediseño: todo en el celular

PeruPOS pasa a ser una herramienta para que el pequeño comerciante organice su negocio
**desde su celular**, sin RUC, sin registro de empresa y sin internet.

## Reglas
- **Un celular por negocio** (primera versión).
- Ventas, productos, inventario, caja, fiados, abonos, tickets e informes funcionan **en el
  celular**, sin internet y sin servidor.
- Solo se pide lo mínimo: nombre del negocio, tu nombre y un PIN. El celular es opcional.
- Los tickets son **comprobantes internos**: no son boletas ni facturas de SUNAT.
- **Nada se envía a terceros automáticamente.** El backend, TAYPI, Nubefact, el padrón, el SIRE
  y las notificaciones por internet quedan como módulos opcionales, apagados.
- **Yape/Plin:** el comerciante revisa su app de Yape y luego lo registra aquí. Ese pago queda
  como **"confirmado manualmente"**, nunca como "verificado". "Verificado" queda reservado
  para una integración externa (módulo opcional, futuro).
- **Copia de seguridad y restauración desde archivo**, para recuperar todo si se cambia o se
  pierde el celular. La copia la guarda el comerciante donde él quiera; no se sube sola.

## Etapas

| Etapa | Qué | Estado |
|---|---|---|
| 1 | Base local, acceso con PIN sin servidor, configuración mínima sin RUC | ✅ hecha |
| 2 | Productos, inventario, ventas (efectivo, Yape/Plin confirmado manualmente, fiado), caja, fiados y abonos en el celular | ✅ hecha |
| 3 | Ticket interno (sin RUC, "no es boleta ni factura") y Yape "confirmado manualmente" en ticket, caja e informes | ⬜ |
| 4 | Informes y alertas en el celular, notificaciones locales | ⬜ |
| 5 | Copia de seguridad y restauración desde archivo | ⬜ |
| 6 | Aislar backend e integraciones como módulos opcionales; documentación final | ⬜ |

## Cómo está hecho
- La lógica local vive en `shared/src/local/` (TypeScript puro). En el celular corre sobre
  `expo-sqlite` (`mobile/src/lib/localDb.ts`); en los tests, sobre el SQLite que trae Node
  (`shared/test/node-local-db.ts`). Es el mismo motor (SQLite), pero **los tests no corren en
  un celular**.
- La base del celular tiene migraciones numeradas (`PRAGMA user_version`). Una base de una
  versión más nueva de la app no se abre (para no dañarla).
- El módulo de servidor se enciende solo al construir la app con
  `EXPO_PUBLIC_SERVER_ENABLED=true`. Apagado, `mobile/src/lib/api.ts` no hace ninguna llamada
  a internet, no se pide token de notificaciones y no se cargan fotos del servidor.

## Etapa 1 — qué hay
- **Primera vez:** nombre del negocio, tu nombre, celular (opcional) y PIN de 4 a 6 números.
  Luego se muestra **una sola vez** un código de recuperación de 10 números para anotar en papel.
- **Entrar:** PIN en el celular. 5 intentos fallidos → espera de 5 minutos.
- **Olvidé mi PIN:** con el código de recuperación se pone uno nuevo.
- **Mi negocio:** editar nombre, celular, mensaje del ticket, fiado máximo, días de vencimiento,
  mínimo de caja y cambiar el PIN.
- Ayudantes con su propio PIN: la lógica y sus tests están hechos; la pantalla llega después.

**Seguridad del PIN, con honestidad:** el PIN se guarda con sal y SHA-256, no tal cual. Protege
contra alguien que agarra el celular y abre la app. No protege contra alguien que saca el archivo
de la base del teléfono (con un PIN de 4 a 6 números se puede adivinar probando todos).

## Etapa 2 — qué hay
- **Catálogo vacío al empezar.** Producto nuevo: nombre, precio, cuántos hay, cuándo avisar
  (opcional), código de barras y foto (opcionales). La foto se copia a la carpeta de la app.
- **Inventario:** "Llegó mercadería" suma al stock; "Conté el anaquel" corrige el stock; cada
  cambio queda en el historial del producto (inicial, ingreso, conteo, venta, anulación).
- **Ventas:** efectivo con vuelto, Yape/Plin, fiado, tarjeta y transferencia, mezclados en una
  venta. Se puede vender aunque el stock diga 0 (en la bodega manda el anaquel).
- **Yape/Plin:** al cobrar, la app pregunta "¿Ya te llegó?"; el comerciante revisa **su** app y
  confirma. Se guarda como `MANUAL` ("confirmado por ti"). Un pago marcado como verificado por
  QR **se rechaza**: sin integración no hay verificación. El N° de operación es opcional; si se
  pone, no se puede repetir en otra venta ni en otro abono.
- **Fiado:** límite por cliente. Si el ayudante se pasa del límite o da más de 10 % de
  descuento, el dueño pone su PIN en el mismo celular.
- **Abonos:** efectivo o Yape/Plin confirmado por el comerciante; nunca más que la deuda;
  constancia con el saldo. Los abonos pagan primero el fiado más antiguo.
- **Caja:** apertura, "saco plata" / "meto plata" con motivo, y cierre con lo contado y lo
  yapeado al dueño. Esperado = apertura + efectivo de ventas − vuelto de yapeos + abonos en
  efectivo + ingresos − retiros.
- **Ventas del día y anulación:** el dueño ve todas; el ayudante, las suyas. Solo el dueño
  anula: vuelve el stock, se descuenta el fiado y el N° de operación queda libre.
- **Modo demostración**, separado: "Probar con datos de ejemplo" en la primera pantalla crea una
  bodega de ejemplo con 20 productos y 3 clientes (PIN 1234). Una franja amarilla lo indica en
  todas las pantallas. "Borrar demostración y empezar mi negocio" lo borra todo. Un negocio
  real nunca se borra con ese botón (la lógica lo impide).

### Garantías probadas con tests (SQLite de Node, no en el celular)
- **Todo o nada:** si una venta, abono o cierre de caja falla a la mitad (se simula un corte
  justo antes del último paso), no queda nada guardado: ni venta, ni stock descontado, ni
  pagos, ni N° de operación, ni deuda.
- **Sin duplicados:** reintentar la misma venta o el mismo abono (doble toque, o volver a tocar
  "Cobrar" después de un error) lo guarda una sola vez. La pantalla de cobro usa el mismo id en
  todos los reintentos.
- **Cerrar y volver a abrir:** con la base en un archivo, se hacen los 3 cobros, un abono y la
  caja abierta; se cierra y se vuelve a abrir la base: ventas, stock, deudas, cuaderno y caja
  son los mismos.
- En el celular las transacciones van en fila (una a la vez) y la lógica nunca abre una
  transacción dentro de otra (el test falla si pasa).

## Lo que todavía NO está listo
| Qué | Etapa |
|---|---|
| **Ticket:** todavía muestra "RUC", "Nuevo RUS" y "Canjeable por comprobante de pago", y no dice "Yape confirmado por ti". Debe decir que es un comprobante interno. | 3 |
| Informes (por semana/mes), alertas de stock bajo y deudas vencidas, notificaciones | 4 |
| **Copia de seguridad y restauración desde archivo** (hasta entonces, si se pierde el celular se pierden los datos) | 5 |
| Pantalla para agregar ayudantes (la lógica ya está) | 4 |
| Categorías de productos (el catálogo funciona sin ellas) | más adelante |
| Ocultar del todo el código del servidor y sus pantallas | 6 |

Con el módulo de servidor encendido (`EXPO_PUBLIC_SERVER_ENABLED=true`), caja, productos y
clientes usan igual la base del celular: ese modo se rehará en la etapa 6.

## Prueba en un Android real (después de la etapa 2)
Con el APK `preview` (no necesita servidor ni la IP de tu PC):
1. Primera vez: nombre del negocio, tu nombre, PIN. Anota el código de recuperación.
2. Productos → Nuevo producto: "Aceite Primor", S/ 10.90, hay 18. Otro: "Pan francés", S/ 0.30, hay 150.
3. Caja → abrir con S/ 100.
4. **Flujo (a):** vende S/ 50 → Efectivo S/ 20 recibido S/ 50 + Yape S/ 30. Al cobrar, "¿Ya te
   llegó?" → "Sí". Vuelto S/ 30.
5. **Flujo (b):** S/ 50 → Efectivo 10 (recibido 20) + Yape 20 + Fiado 20 a un cliente nuevo.
   Vuelto S/ 10; el cliente debe S/ 20.
6. **Flujo (c):** S/ 32 → Yape, "Me yapeó más: dar vuelto", te yapeó 40. Vuelto S/ 8 en efectivo.
7. Abono de S/ 5 por Yape del cliente del paso 5 → debe S/ 15.
8. Caja: debe decir 100 + 30 − 8 = S/ 122. Revisa que el stock bajó en Productos.
9. **Cierra la app del todo** (quítala de recientes) y **apaga el celular**. Préndelo, entra con
   el PIN y revisa: ventas, stock, deuda (S/ 15) y caja (S/ 122) siguen iguales.
10. Modo avión todo el tiempo: nada de lo anterior necesita internet.
11. Toca "Cobrar" dos veces seguidas rápido: debe quedar una sola venta.

**No uses esta versión en la tienda todavía:** falta la copia de seguridad (etapa 5) y el ticket
interno (etapa 3).
