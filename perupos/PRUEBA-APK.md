# Prueba del APK en un Android real

La app funciona **solo en el celular**: sin servidor, sin internet y sin RUC. Esta prueba es la
que decide si se puede usar en una tienda. **Hasta que salga bien completa (ventas, copia y
recuperación), no se usa con datos reales.** Que compile y pasen los tests no basta: los tests
corren en la computadora, no en el teléfono.

## 1. Construir el APK (una sola vez, ~15–30 min)

Necesitas una computadora con Node.js 22 y git, y una cuenta gratis en https://expo.dev. El
APK se construye en los servidores de Expo: no necesitas Android Studio.

```bash
git clone https://github.com/lenosito159-bit/Visible-Digital.git
cd Visible-Digital
git checkout claude/bold-ride-0su48m
cd perupos
npm ci                                   # instala todo y prepara el paquete "shared"
cd mobile
npx eas-cli@latest login                 # tu usuario y contraseña de expo.dev
npx eas-cli@latest init                  # crea el proyecto en Expo (responde "Yes")
npx eas-cli@latest build --platform android --profile preview
```

- `eas init` agrega un `projectId` a `mobile/app.json`; puedes dejarlo solo en tu computadora.
- Al terminar sale un **enlace y un QR** para descargar el APK (también en expo.dev → Builds).
- Si falla, pásame el enlace del build o el error de la terminal.

## 2. Instalar

1. En el Android, abre el enlace (o escanea el QR) y descarga el `.apk`.
2. Ábrelo y permite **"Instalar apps desconocidas"** si lo pide.
3. Si Play Protect dice "App no verificada": **Más detalles → Instalar de todas formas**.
4. Ideal: un celular de gama baja (tipo Redmi 9A o Samsung A0x).

Anota ✅ o ❌ en cada paso. Si algo falla, captura de pantalla + número de paso.

---

## Parte A — Demostración: ventas, copia, desinstalar y recuperar (primero esto)

Se hace con datos de ejemplo para no arriesgar nada. **Modo avión** salvo donde se indica.
Los nombres de productos son los de la demostración (escríbelos así en el buscador). Todos
los números de esta parte están comprobados por el test `shared/test/guia-demo.test.ts`, que
hace estos mismos pasos con la lógica de la app.

### A1. Abrir la demostración
1. Abre la app → **Probar con datos de ejemplo**. Sale una franja amarilla
   **DEMOSTRACIÓN** en todas las pantallas. Entras como "Dueño de prueba" (PIN **1234**).
2. **Caja → Abrir** con S/ 100.

### A2. Los 3 flujos de cobro
3. **(a) Efectivo + Yape.** Nueva venta: **Cerveza Pilsen Callao 630 ml** ×4, **Inca Kola 1.5 L**
   ×2, **Coca-Cola 500 ml** ×2 = **S/ 50**. Cobrar: Efectivo 20, "¿Con cuánto paga?" 50 → **+ Agregar otro
   método** → Yape 30. Al tocar **Cobrar**: "¿Ya te llegó?" → N° de operación **123456** →
   **Sí, ya me llegó**.
   - Vuelto **S/ 30.00**. Ticket: **COMPROBANTE INTERNO**, "Venta N° 000001", Efectivo 20 /
     Entregó 50, Yape 30 con **"Confirmado manualmente por el comerciante"** y la operación,
     **VUELTO S/ 30.00**, y "Comprobante interno del negocio. No es boleta ni factura."
   - Sin RUC, IGV, SUNAT, "nota de venta" ni "canjeable".
4. **(b) Efectivo + Yape + fiado.** Otra venta igual de S/ 50: Efectivo 10 (paga con 20),
   agrega Yape 20, agrega otro método y toca **Fiado** 20 → Elegir cliente → **Pedro
   Castillo**. Confirma el Yape (sin N° de operación).
   - Vuelto **S/ 10.00**. Ticket: "Fiado (queda debiendo) S/ 20.00" y "Pedro queda debiendo
     S/ 20.00 de esta compra."
5. **(c) "Te yapeo 40, dame el vuelto".** **Aceite vegetal Primor 900 ml** ×2, **Leche
   evaporada Gloria 400 g** ×2, **Pan francés (unidad)** ×4 = **S/ 32**. Yape → **"Me yapeó más: dar vuelto"** → 40. Confirma.
   - Vuelto **S/ 8.00**. Ticket: Yape 32, **Yapeó 40**, confirmado manualmente, VUELTO 8.
6. Otra venta con Yape y el N° de operación **123456**: debe **rechazarlo** y volver a
   preguntar "¿Ya te llegó?". Sal sin cobrar y vacía el carrito.
7. **Doble toque:** vende 1 Pan francés en efectivo tocando **Cobrar** dos veces rápido.
   En **Ventas** debe aparecer **una sola** venta nueva (S/ 0.30).

### A3. Fiados, abonos y caja
8. **Abono** de Pedro: S/ 5 por **Yape** → "¿Ya te llegó?" → Sí. Constancia: Debía 20.00,
   Abonó (Yape) −5.00, "Confirmado manualmente por el comerciante", **AHORA DEBE S/ 15.00**.
9. **Abono** de Juan Pérez: S/ 10 en **efectivo** → ahora debe **S/ 35.00**.
10. **Caja**: "Debe haber" **S/ 132.30**. Así se forma (solo cuenta lo que entra o sale del
    cajón en efectivo):

    | Paso | Movimiento | Efectivo en el cajón |
    |---|---|---|
    | 2 | Apertura | + 100.00 |
    | 3 | (a) parte en efectivo (entregó 50, vuelto 30 sale del mismo billete) | + 20.00 |
    | 4 | (b) parte en efectivo (entregó 20, vuelto 10) | + 10.00 |
    | 5 | (c) vuelto en efectivo de un Yape de más (yapeó 40 por 32) | − 8.00 |
    | 7 | Pan francés en efectivo (prueba de doble toque) | + 0.30 |
    | 9 | Abono de Juan en **efectivo** | + 10.00 |
    | | **Debe haber** | **= 132.30** |

    No cuentan en el cajón: los Yape (30, 20, 32 y el abono de 5 de Pedro, van a tu app de
    Yape) ni el fiado de 20.

    > **¿Por qué antes era S/ 122?** La guía de la etapa 2 tenía solo 100 + 20 + 10 − 8 = 122.
    > Esta guía agrega dos movimientos en efectivo que antes no estaban: la venta de 1 Pan
    > francés del paso 7 (**+ 0.30**) y el abono de Juan en efectivo del paso 9 (**+ 10.00**).
    > 122 + 0.30 + 10 = **132.30**. El cálculo de la app no cambió; cambiaron los pasos.
11. Productos: Cerveza Pilsen **16**, Inca Kola 1.5 L **16**, Coca-Cola 500 ml **44**, Aceite
    vegetal Primor **16**, Leche evaporada Gloria **46**, Pan francés **145**.
11b. **Foto:** Productos → **Aceite vegetal Primor 900 ml** → **Cambiar foto** → toma una foto de cualquier cosa
    (los productos de ejemplo vienen sin foto; esta sirve para comprobar que la copia la
    recupera). Debe verse en la lista de productos y en la venta.

**Anota estos números:** los vas a comparar después de recuperar la copia.

### A4. Copia de seguridad con contraseña
12. Inicio → **Mi negocio** → Copia de seguridad → **1. Hacer la copia**. Lee el aviso sobre
    la contraseña. Pon **`prueba demo 2026`** dos veces → **Hacer copia y compartirla**
    (puede tardar unos segundos: anota cuántos).
13. **Quita el modo avión.** En el menú de compartir guárdala en **Drive** (o en "Archivos" →
    Descargas). Mándala también a ti mismo por WhatsApp.
    - La app **no** debe decir "copia guardada": debe decir que se abrió el menú y que todavía
      no sabe si se guardó.
14. **Antes de desinstalar, comprueba que la copia está FUERA de la app y se abre.**
    **2. Comprobar que quedó guardada** → elige el archivo **desde Drive o Descargas** (no
    desde la carpeta de la app):
    - con **`prueba demo 2025`** (equivocada): debe decir que la contraseña no es la de esta copia;
    - con **`prueba demo 2026`**: **"Copia comprobada"**, con la fecha y 4 ventas, 20
      productos y 3 clientes.
    - **No pases al paso 16 si esto no salió bien**: desinstalar borra todo lo del celular.
15. **3. Recuperar** → elige una **foto** o un PDF: debe decir que **no es una copia de
    PeruPOS** y no cambiar nada.

### A5. Desinstalar y recuperar (lo más importante)
16. **Desinstala la app** (se borra todo lo del celular). Vuelve a instalar el APK.
17. Primera pantalla → **Recuperar mi negocio desde una copia** → elige el archivo (de Drive o
    Descargas; necesitas señal para bajarlo). Debe mostrar "Bodega de demostración" y la fecha
    **antes** de pedir la contraseña.
18. Pon la contraseña **equivocada**: no debe abrir. Pon **`prueba demo 2026`** → revisa el
    resumen (4 ventas, 20 productos, 3 clientes, **1 foto**) → **Recuperar esta copia**.
19. Entra con el PIN **1234**. Revisa que todo esté **igual que en A3**:
    - Ventas: las 4, con sus tickets (Yape "Confirmado manualmente por el comerciante").
    - Deudas: Pedro **S/ 15.00**, Juan **S/ 35.00**, María **S/ 46.00**.
    - Caja abierta con **S/ 132.30** (mismo detalle del paso 10).
    - Stock como en el paso 11.
    - La **foto del Aceite vegetal Primor** (paso 11b) en la lista de productos.
    - La franja amarilla de DEMOSTRACIÓN.
20. Vende 1 Pan francés: debe ser la **Venta N° 000005** (la numeración sigue).
21. Un Yape con el N° de operación **123456**: debe seguir **rechazado**.
22. (Si tienes otro celular) instala el APK y recupera la misma copia: debe quedar igual.

**Si olvidas la contraseña de una copia, esa copia no se puede abrir de ninguna forma.** En el
paso 18 no hay otra salida que la contraseña correcta.

---

## Parte B — Tu negocio de prueba desde cero

23. Inicio → **Borrar demostración y empezar mi negocio**.
24. Primera pantalla: nombre del negocio, tu nombre, PIN (celular opcional). **Nada de RUC.**
    Anota el **código de recuperación**.
25. Cierra la app (quítala de recientes) y ábrela: pide el PIN. Pon uno equivocado 2 veces:
    dice cuántos intentos quedan.
26. **Productos** está vacío. **Nuevo producto**: "Aceite Primor" 10.90, hay 18, avisar
    cuando queden 5, con foto. Crea 2 o 3 más.
27. Abre un producto: **Llegó mercadería** 24 y **Conté el anaquel**; abajo se ven los
    movimientos.
28. Haz una venta mixta y un fiado a un **cliente nuevo**; tocar "Guardar" dos veces al crear
    el cliente no debe crear dos.
29. **Informes** → Hoy: vendido, cómo te pagaron (nota de Yape confirmado manualmente), lo más
    vendido. Pon costo al Aceite y mira la **ganancia aproximada**.
30. **Avisos**: corrige el stock del Aceite a 3 con "Conté el anaquel": sale **"Queda poco"** en
    Avisos y como **notificación** (acepta el permiso la primera vez).
31. **Ayudantes** → agrega "Pepe" (PIN 1357). Entra como Pepe: vende y usa la caja, pero no ve
    Informes ni cambia precios.
32. **Apaga el celular**, préndelo, entra: ventas, stock, deudas y caja siguen iguales.
33. **Olvidé mi PIN**: con el código del paso 24 pon un PIN nuevo y entra.
34. Inicio del dueño: debe salir el aviso **"Todavía no tienes una copia de seguridad"**. Haz
    una copia, guárdala y **comprúebala**: el aviso desaparece.
35. Comparte un ticket por **WhatsApp** y como **PDF**: dicen lo mismo que en pantalla.

## 3. Qué mandarme
- La lista ✅/❌ por número de paso.
- Capturas: un ticket de cada flujo (pasos 3, 4 y 5), las pantallas de los pasos 17–18 y lo
  que falle.
- Cuántos segundos tardó "Protegiendo la copia" (paso 12) y "Abriendo" (paso 18).
- Modelo del celular y versión de Android.
- Cualquier palabra que un tendero no entendería.

El PR #2 queda **sin fusionar** hasta revisar esta prueba.
