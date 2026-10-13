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
| 3 | Ticket interno (sin RUC, "no es boleta ni factura") y Yape "confirmado manualmente" en ticket, caja e informes | ✅ hecha |
| 4 | Informes y alertas en el celular, notificaciones locales | ✅ hecha (falta probar en el celular) |
| 5 | Copia de seguridad y restauración desde archivo | ✅ hecha (falta probar en el celular) |
| 6 | Separar el código del servidor; copias con contraseña; documentación final | ✅ hecha (falta probar en el celular) |

## Cómo está hecho
- La lógica local vive en `shared/src/local/` (TypeScript puro). En el celular corre sobre
  `expo-sqlite` (`mobile/src/lib/localDb.ts`); en los tests, sobre el SQLite que trae Node
  (`shared/test/node-local-db.ts`). Es el mismo motor (SQLite), pero **los tests no corren en
  un celular**.
- La base del celular tiene migraciones numeradas (`PRAGMA user_version`). Una base de una
  versión más nueva de la app no se abre (para no dañarla).
- La app no tiene código que hable con un servidor: el cliente anterior está separado en
  `mobile/modulo-servidor/` (no se compila ni va en el APK) y el backend en `backend/`.

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
| Categorías de productos (el catálogo funciona sin ellas) | más adelante |

## Etapa 3 — ticket interno
- **COMPROBANTE INTERNO** con "Venta N° 000001": nombre del negocio, celular (si lo puso),
  fecha, quién atendió, cliente, productos, **TOTAL**, **CÓMO PAGÓ**, **VUELTO** y, si fió,
  cuánto quedó debiendo de esa compra y su deuda total.
- Yape y Plin: debajo de cada uno, **"Confirmado manualmente por el comerciante"** (y el N° de
  operación si se puso). Si yapeó de más: "Yapeó S/ 40.00" y el vuelto.
- Abajo: "Comprobante interno del negocio. No es boleta ni factura."
- Sin RUC, régimen, IGV, SUNAT, "nota de venta" ni "canjeable" (un test lo revisa en texto y HTML).
- Lo mismo en la constancia de abono ("Debía / Abonó / AHORA DEBE") y en el resumen de caja.
- Cabe en 32 columnas (ticketera de 58 mm). El mismo contenido sale en texto (WhatsApp) y en
  HTML (imprimir / PDF).
- La lista de ventas muestra "Venta N° 000001" (antes "NV-000001").
- El APK ya no permite conexiones `http://` salvo con el módulo de servidor encendido.

## Etapa 4 — informes, avisos y ayudantes
- **Informes** (dueño): hoy, ayer, últimos 7 días, este mes y el mes pasado (hora de Lima).
  Vendido, N° de ventas, venta promedio, cuánto te deben, ventas por día (barras), cómo te
  pagaron (Yape/Plin con la nota "confirmados manualmente"), fiado dado y abonos cobrados,
  **ganancia aproximada** (solo de productos con costo anotado; dice cuánto queda sin costo) y
  lo más vendido. Las ventas anuladas no cuentan, pero se dice cuántas hubo.
- **Avisos**: se acabó o queda poco (según "avisar cuando queden"), fiado vencido (días sin
  abonar > los de "Mi negocio"), cliente cerca o encima de su límite, poco sencillo en la caja y
  producto que no se vende hace 30 días. No se guardan: se calculan al abrir la pantalla y
  desaparecen solos cuando se resuelven. Tocar un aviso abre el producto, el cliente o la caja.
- **Notificaciones del celular** (sin internet): al entrar con el PIN y después de vender,
  abonar o mover stock, los avisos **nuevos** salen como notificación (máximo 3 + "N avisos
  más"). Cada aviso se notifica una vez; si se resuelve y vuelve, se notifica otra vez.
  **Con la app cerrada no llegan avisos** (no hay tarea en segundo plano).
- **Ayudantes**: el dueño agrega ayudantes con nombre y PIN y les puede quitar el acceso. El
  ayudante vende, fía, cobra abonos y usa la caja; no cambia precios, no ve informes ni anula.
- APK: permiso de notificaciones (Android 13+) declarado; micrófono y "mostrar sobre otras
  apps" bloqueados (la app no los usa).

## Etapa 5 — copia de seguridad y recuperación
- **Hacer copia** (Mi negocio): un archivo `.json` con todo el negocio (negocio, usuarios y sus
  PIN cifrados, productos, stock e historial, clientes y cuaderno, ventas y pagos, caja) y las
  fotos de los productos. Se abre el menú de compartir del celular para guardarla **fuera**
  (WhatsApp a uno mismo, Drive, correo). La app no la sube a ningún lado.
- Dentro de la app quedan las últimas 5 copias (no sirven si se pierde el celular).
- **Recuperar**: en la primera pantalla de un celular nuevo ("Recuperar mi negocio desde una
  copia") o en Mi negocio. Muestra negocio, fecha y cuántas ventas/productos/clientes trae
  antes de confirmar. En Mi negocio pide confirmar dos veces y antes guarda lo actual
  ("antes-de-recuperar").
- Se entra con el PIN que había al hacer la copia; el código de recuperación sigue sirviendo.
  La numeración de ventas sigue, y los N° de operación usados siguen bloqueados.
- **Protecciones (probadas con tests):** huella SHA-256 del contenido: un archivo editado,
  cortado, de otra app o de una versión más nueva **no se restaura**. La recuperación es una
  sola transacción: si falla a la mitad, el celular queda **exactamente** como estaba.
- **Recordatorio** en el inicio del dueño si nunca hizo copia o si pasó una semana (no en la
  demostración).
- (Desde la etapa 6 la copia va **cifrada con contraseña** y solo cuenta como guardada cuando
  se comprueba abriéndola; ver abajo.)

## Etapa 6 — separación del servidor y copias con contraseña
- **Separación:** la app (`mobile/src`) solo tiene lo que funciona en el celular. Se quitaron
  el inicio de sesión con servidor, la cola de envíos, el cobro con QR de TAYPI, las
  notificaciones push, el Agente Financiero, la pantalla con RUC/régimen/cuentas y el SIRE.
  Esos archivos están en `mobile/modulo-servidor/` con un README de qué haría falta para
  volver a usarlos. El backend con TAYPI, Nubefact, padrón y SIRE sigue en `backend/`, con
  sus tests en CI, y su documentación en `backend/README.md`.
- Dependencias del celular que solo usaba el servidor, quitadas: netinfo, secure-store,
  expo-device, qrcode. El bundle pasó de 4.5 MB a 3.6 MB. Android no permite `http://`.
- **Copias con contraseña** (mínimo 8 caracteres): cifradas con XChaCha20-Poly1305 y clave
  PBKDF2-SHA256 (150 000 vueltas). Sin la contraseña no se pueden leer; a la vista solo el
  nombre del negocio y la fecha. **Si se olvida la contraseña, esa copia no se puede abrir.**
- **"Copia hecha" ≠ "copia guardada":** abrir el menú de compartir ya no cuenta. La copia
  queda "sin comprobar" hasta que el comerciante la abre desde donde la guardó (con la
  contraseña) o la recupera. El recordatorio sigue mientras no haya una copia comprobada.
- Clientes: crear con doble toque ya no crea dos.

## Alcance acordado: cerrado
Las 6 etapas están hechas en el código. Lo que falta **no es código**: es la prueba en un
Android real ([`PRUEBA-APK.md`](PRUEBA-APK.md)), empezando por la demostración (ventas, copia,
desinstalar y recuperar). Lo que salga de esa prueba se corrige antes de usarla en una tienda.

Fuera del alcance (posibles siguientes pasos, no pedidos): categorías de productos, varios
celulares por negocio, Yape verificado con TAYPI (necesita servidor), comprobantes de SUNAT.

## Prueba en un Android real
Instrucciones completas para construir, instalar y probar: [`PRUEBA-APK.md`](PRUEBA-APK.md).

**No uses esta versión en una tienda** hasta que la prueba en el celular salga bien completa,
incluida la recuperación de una copia de seguridad en un celular recién instalado. Que compile
y pasen los tests no basta: los tests corren en el SQLite de Node, no en el teléfono.
