# Prueba de humo en el celular (15 pasos)

Tiempo estimado: 40 minutos. Hazlo en un Android real (ideal: gama baja, tipo Redmi 9A o
Samsung A0x) con el APK del perfil `preview`. Anota ✅ / ❌ y una foto de pantalla si algo falla.

**Antes de empezar**

- Servidor corriendo en tu computadora con datos de demo:
  `npm run db:seed -- --demo` y `npm run dev:backend` (desde `perupos/`).
- Celular y computadora en la **misma WiFi**. La IP de la computadora debe ser la misma que
  pusiste en `mobile/eas.json` (`EXPO_PUBLIC_API_URL`).
- `PAYMENTS_PROVIDER=mock`: el QR no cobra de verdad y aparece el botón **Simular pago**.
  Con TAYPI sandbox, paga el QR con la app de prueba que te den.
- Abre la caja al empezar (paso 4) para que el cierre del paso 15 tenga sentido.
- Antes del celular, prueba el servidor solo (2 segundos), con la base recién sembrada:
  `npm run test:flujos -- --base-de-prueba`. Debe terminar en "0 mal". Luego vuelve a
  sembrar (`npm run db:seed`) porque esa prueba deja ventas y la caja abierta.

Precios del seed usados abajo: Cerveza Pilsen 630 ml S/ 7.50 · Inca Kola 1.5 L S/ 7.00 ·
Coca-Cola 500 ml S/ 3.00 · Aceite Primor S/ 10.90 · Leche Gloria S/ 4.50 · Pan S/ 0.30.

---

### 1. Entrar como Vendedor
Rol **Vendedor** → usuario `carlos` → PIN `1111`.
**Esperado:** 4 botones grandes (Nueva Venta, Fiado, Abono, Mis Ventas) + Caja y Alertas.
No aparece nada de precios, usuarios ni reportes del negocio.

### 2. Entrar como Agente Financiero
Salir → rol **Agente Financiero** → `lucia` / `2222`.
**Esperado:** tablero con ventas del día, flujo de caja, proyección, top 5 y mapa de calor.
No hay botón para vender. Toca *Enviar* en una recomendación.

### 3. Entrar como Administrador
Salir → rol **Administrador** → `admin` / `1234`.
**Esperado:** panel con Vender, Productos, Usuarios, Mi negocio. Abre *Alertas* y verifica que
ves la recomendación que mandó Lucía en el paso 2.
Prueba también: PIN equivocado 5 veces con otro usuario → "Espera 5 minutos".

### 4. Abrir la caja
Como Vendedor: *Caja* → "¿Con cuánto abres?" → `100` → **Abrir caja**.
**Esperado:** "Debe haber en caja S/ 100.00".

### 5. Escanear un producto real
*Nueva Venta* → **Escanear** → apunta al código de barras de una gaseosa o galleta que tengas
a la mano (no está en el seed).
**Esperado:** vibra y abre "Producto nuevo" con el código ya puesto. Pon nombre, precio
`2.50`, categoría y **toma una foto**. Guardar → vuelve a la venta con el producto en el
carrito. Escanéalo otra vez: la cantidad sube a 2 (no se duplica la línea).
Vacía el carrito al terminar.

### 6. Efectivo con vuelto — "Págame 32, aquí tienes 50"
Carrito: Aceite Primor ×2 (21.80) + Leche Gloria ×2 (9.00) + Pan ×4 (1.20) = **S/ 32.00**.
Cobrar → Efectivo → "¿Con cuánto paga?" → toca **S/ 50.00**.
**Esperado:** "VUELTO S/ 18.00" en grande. Cobrar → ticket con RUC, IGV y "Vuelto S/ 18.00".
Prueba *Imprimir* (o PDF) y *WhatsApp*.

### 7. Mixta — "Te doy 20 en efectivo y el resto yapéame"
Carrito: Pilsen ×4 (30.00) + Inca Kola 1.5 L ×2 (14.00) + Coca-Cola ×2 (6.00) = **S/ 50.00**.
Cobrar → Efectivo: escribe `20` → **+ Agregar otro método** → **Yape**.
**Esperado:** Yape se llena solo con **S/ 30.00**. Toca *Exacto* en efectivo. Cobrar → QR de
**S/ 30.00** con temporizador **2:00** → paga (o *Simular pago*). La venta se registra sola y
el ticket dice "Efectivo S/ 20.00 / Yape S/ 30.00".

### 8. Mixta — "Tengo 15 sueltos, ¿me completas con Plin?"
Carrito: Pilsen ×4 (30.00) + Inca Kola 1.5 L ×1 (7.00) + Coca-Cola ×1 (3.00) = **S/ 40.00**.
Efectivo `15` → + Agregar → **Plin** (se llena con S/ 25.00) → Cobrar → paga el QR **con la app
Plin** (con TAYPI real). Deja que el QR venza una vez: debe decir "El QR venció" y
**Generar nuevo QR** debe funcionar.
**Esperado:** ticket "Efectivo S/ 15.00 / Plin S/ 25.00". Con TAYPI real: si eliges Yape pero
el cliente paga con Plin, se registra como **Plin** (si TAYPI informa la app; ver QA.md §C).

### 9. Triple — "10 en efectivo, 20 te yapeo y 20 apúntamelo"
Mismo carrito del paso 7 (**S/ 50.00**). Efectivo `10` → + Agregar → Yape → cambia Yape a `20`
→ + Agregar → **Fiado** (se llena solo con S/ 20.00) → Elegir cliente → **Pedro Castillo Ramos**.
**Esperado:** "Deberá S/ 20.00 de S/ 50.00". Cobrar → QR por S/ 20 → pagado → ticket con los
tres métodos. En *Fiado → Pedro* aparece la deuda de S/ 20.00.

### 10. Fiado total a cliente nuevo — "Apúntamelo, soy la del puesto 12"
Carrito de **S/ 45.00** (Pilsen ×6). Cobrar → cambia Efectivo por **Fiado** → Elegir cliente →
**Nuevo cliente** → "Sra. Rosa (puesto 12)", celular `987 000 111` → Guardar.
**Esperado:** se registra; su límite es S/ 50.00. Haz otra venta de S/ 10.00 fiada a la misma
señora: **"Supera su límite"** → pide el PIN del Administrador (`admin` / `1234`) → se registra.
Sin internet esta autorización no se puede dar: la app lo dice.

### 11. Abono parcial con Yape — "Te abono 20 de los 45"
*Abono* → **Juan Pérez** (debe S/ 45.00) → `20` → **Yape** → Registrar → QR S/ 20.00 → pagado.
**Esperado:** constancia "Deuda anterior S/ 45.00 · Abono (Yape) -S/ 20.00 · SALDO PENDIENTE
S/ 25.00". Envíala por WhatsApp. En la ficha de Juan: el historial muestra el abono por Yape.

### 12. Yapeó de más — "Te yapeo 40, dame el vuelto"
Carrito de **S/ 32.00** (como el paso 6). Cobrar → cambia Efectivo por **Yape** → activa
**"Me yapeó más: dar vuelto"** → "¿Cuánto te yapeó?" `40`.
**Esperado:** "Vuelto en efectivo S/ 8.00". El QR es por **S/ 40.00**. Tras pagar, el ticket
dice Yape S/ 32.00, Recibido S/ 40.00, Vuelto S/ 8.00, y la caja baja S/ 8.00.
Variante sin QR: *El cliente pagó con el QR del mostrador* → escribe el **N° de operación**
de Yape. Repite otra venta con el **mismo número**: debe rechazarse ("ya se usó").

### 13. Sin señal — "Se cayó el internet"
Activa **modo avión**. Haz 2 ventas en efectivo de S/ 3.00 (una Coca-Cola cada una).
**Esperado:** barra superior **ámbar** "No hay señal — sigue vendiendo nomás · 2 por enviar".
Los tickets salen con "Número por asignar". Quita el modo avión y espera ~10 s (o toca la barra).
**Esperado:** barra verde "En línea". En *Mis Ventas* aparecen **exactamente 2** ventas nuevas
(no 4). Toca la barra varias veces seguidas: no se duplican.

### 14. Recordatorio de fiado por WhatsApp
*Fiado → Por cobrar* → orden **Mayor deuda** → Juan Pérez → botón verde de WhatsApp.
**Esperado:** WhatsApp abre con un mensaje tipo *"Don Juan, le recuerdo su cuenta: S/ 25.00
desde el 21 de agosto. Cuando pueda, aquí lo espero. Gracias, Bodega Doña Rosa."* (tono
respetuoso; la fecha es la de su fiado pendiente más antiguo; setiembre se escribe con t).
Filtro **Vencidos (+30 días)**: Juan ya **no** aparece porque abonó en el paso 11 (correcto:
vencido = más de 30 días sin abonar). Si es día 14–16 o fin de mes, la pantalla avisa que es
quincena / fin de mes.
Marca a Juan como "Le cuesta pagar" y a Pedro como "Siempre paga": se ve el ícono en la lista.

### 15. Cierre de caja
*Caja* → revisa el desglose: efectivo, Yape, Plin, fiado y abonos del turno.
Cuenta la plata del cajón y escríbela. Si yapeaste al administrador para cuadrar, escribe
cuánto en "Le yapeé al administrador".
**Esperado:** "Cuadra exacto" o "Faltan / Sobran S/ X". Comparte el resumen por WhatsApp.
Entra como Admin → *Mi negocio* no cambió; *Ventas de hoy* coincide con lo que vendiste.

---

**Anota también:** ¿la app se sintió lenta en algún momento? ¿Algún texto no se entendió?
¿Algún botón era difícil de tocar? ¿Se leía bien al sol?
