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
| 2 | Productos, inventario, ventas (efectivo, Yape/Plin confirmado manualmente, fiado), caja, fiados y abonos en el celular | ⬜ |
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

## Etapa 1 — qué todavía NO funciona sin servidor
Vender, caja, clientes, fiados, abonos, informes, alertas y editar productos siguen usando el
código anterior, que pedía el servidor. Con el servidor apagado, esas pantallas no envían nada:
las ventas y abonos quedan guardados en el celular en una cola, y lo que solo existía en el
servidor (caja, informes, alertas) muestra que necesita el servidor. Eso se reemplaza en las
etapas 2 a 4. **No uses esta versión todavía en la tienda.**
