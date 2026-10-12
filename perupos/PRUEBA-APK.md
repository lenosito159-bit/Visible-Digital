# Prueba del APK en un Android real

Esta versión funciona **solo en el celular**: sin servidor, sin internet y sin RUC. El APK se
construye en los servidores de Expo (EAS), así que en tu computadora **no** necesitas Android
Studio ni el SDK de Android.

> Lo que todavía falta (no lo pruebes aún): copia de seguridad y restauración (etapa 5) e
> informes y alertas (etapa 4). **No uses esta versión en la tienda con datos reales.**

## 1. Construir el APK (una sola vez, ~15–30 min)

Necesitas: una computadora con Node.js 22 y git, y una cuenta gratis en https://expo.dev.

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

- `eas init` agrega un `projectId` a `mobile/app.json`. Puedes dejar ese cambio solo en tu
  computadora o pasármelo para guardarlo en la rama.
- El perfil `preview` hace un **APK** para instalar directo (no pasa por Play Store) y **no**
  necesita la IP de tu computadora ni ningún servidor.
- Al terminar, la terminal muestra un **enlace y un QR** para descargar el APK. También queda
  en https://expo.dev → tu proyecto → Builds.
- Si la compilación falla, copia el enlace del build (o el error de la terminal) y pásamelo.

## 2. Instalar en el celular

1. En el Android, abre el enlace o escanea el QR y descarga el `.apk`.
2. Ábrelo. Si Android pregunta, permite **"Instalar apps desconocidas"** para el navegador.
3. Si aparece Play Protect ("App no verificada"), toca **Más detalles → Instalar de todas formas**.
   Es normal: el APK de prueba no viene de Play Store.
4. Ideal: un celular de gama baja (tipo Redmi 9A o Samsung A0x), que es el que usaría un tendero.

## 3. Qué probar (≈40 min)

**Pon el celular en modo avión antes de abrir la app y déjalo así hasta el final.**
Anota ✅ o ❌ en cada paso; si algo falla, toma captura y anota el número de paso.

### Primera vez y acceso
1. Abre la app. Debe pedir solo **nombre del negocio, tu nombre, celular (opcional) y PIN**.
   Nada de RUC, correo ni internet.
2. Anota el **código de recuperación** de 10 números.
3. Cierra la app (quítala de recientes), ábrela: pide el PIN. Pon uno equivocado 2 veces:
   dice cuántos intentos quedan. Entra con el correcto.

### Productos e inventario (el catálogo empieza vacío)
4. Inicio → **Productos**: está vacío. **Nuevo producto**: "Aceite Primor", precio 10.90,
   hay 18, avisar cuando queden 5. Toma una foto.
5. Crea también: "Leche Gloria" 4.50 (hay 48), "Pan francés" 0.30 (hay 150),
   "Cerveza Pilsen" 7.50 (hay 24), "Inca Kola 1.5 L" 7.00 (hay 20), "Coca-Cola 500 ml" 3.00 (hay 48).
6. Abre "Coca-Cola": **Llegó mercadería** 24 → hay 72. **Conté el anaquel**: 70 → hay 70.
   Abajo, en Movimientos, se ven los tres cambios.

### Caja
7. **Caja → Abrir** con S/ 100.

### Los 3 flujos de cobro
8. **(a) Efectivo + Yape.** Vender: Pilsen ×4, Inca Kola ×2, Coca-Cola ×2 = **S/ 50**.
   Cobrar: Efectivo 20 con "¿Con cuánto paga?" 50 → **+ Agregar otro método** → Yape 30.
   Al tocar **Cobrar** pregunta **"¿Ya te llegó?"**: escribe un N° de operación (ej. 123456) y
   toca **Sí, ya me llegó**.
   - Pantalla: vuelto **S/ 30.00**.
   - Ticket: **COMPROBANTE INTERNO**, "Venta N° 000001", Efectivo 20 / Entregó 50,
     Yape 30 con **"Confirmado manualmente por el comerciante"** y el N° de operación,
     **VUELTO S/ 30.00**, y abajo "Comprobante interno del negocio. No es boleta ni factura."
   - El ticket **no** debe decir RUC, Nuevo RUS, IGV, SUNAT, "nota de venta" ni "canjeable".
9. **(b) Efectivo + Yape + fiado.** Otra venta igual de S/ 50: Efectivo 10 (paga con 20),
   agrega Yape 20, agrega otro método y toca **Fiado** (20) → Elegir cliente →
   **Nuevo cliente** "Pedro". Confirma el Yape.
   - Vuelto **S/ 10.00**. Ticket: "Fiado (queda debiendo) S/ 20.00" y
     **"Pedro queda debiendo S/ 20.00 de esta compra."**
10. **(c) "Te yapeo 40, dame el vuelto".** Vender: Aceite ×2, Leche ×2, Pan ×4 = **S/ 32**.
    Método Yape → **"Me yapeó más: dar vuelto"** → ¿cuánto te yapeó? 40. Confirma.
    - Vuelto **S/ 8.00** en efectivo. Ticket: Yape 32, **Yapeó 40**, confirmado
      manualmente, **VUELTO S/ 8.00**.
11. Crea "Caramelo" a S/ 0.10 (hay 50) y véndelo cobrando con **Yape** (así no cambia la caja
    ni el stock de los pasos siguientes). En "¿Ya te llegó?" escribe el **mismo N° de
    operación del paso 8** (123456): debe **rechazarlo**. Vuelve a cobrar sin N° de operación.
12. Repite una venta de Caramelo con Yape y toca **Cobrar dos veces seguidas rápido**: en
    "Ventas" debe aparecer **una sola** venta nueva de S/ 0.10.

### Fiados y abonos
13. **Abono**: Pedro → 5 por **Yape** → "¿Ya te llegó?" → Sí. Constancia: "Debía S/ 20.00",
    "Abonó (Yape) -S/ 5.00", "Confirmado manualmente por el comerciante", **"AHORA DEBE S/ 15.00"**.
14. Intenta abonar **S/ 50** a Pedro: no debe dejar (debe solo 15).
15. Ficha de Pedro: el cuaderno muestra el fiado y el abono "(Yape, confirmado por ti)".

### Caja y cierre
16. **Caja**: "Debe haber" = 100 + 30 − 8 = **S/ 122.00**. Se ve el vuelto de yapeos (−8) y la
    nota "Yape y Plin: confirmados manualmente por el comerciante".
17. Revisa **Productos**: el stock bajó (Pilsen 24 → 16, Aceite 18 → 16, etc.).

### Lo más importante: que no se pierda nada
18. **Cierra la app** (quítala de recientes) y **apaga el celular**. Préndelo, abre la app,
    entra con el PIN y revisa que siga todo igual: ventas (Inicio → Ventas), stock, deuda de
    Pedro (**S/ 15.00**) y caja (**S/ 122.00**).
19. **Cierre de caja**: cuenta 122 → "Cuadra exacto". **Mandar resumen por WhatsApp**: se abre
    WhatsApp con el resumen (si estás en modo avión, se enviará cuando haya señal; la app no
    envía nada sola).

### Compartir el ticket
20. En un ticket: **Imprimir**, **PDF** y **Enviar por WhatsApp**. El PDF y el mensaje deben
    decir lo mismo que el ticket de la pantalla (sin RUC).

### Olvidé mi PIN
21. Bloquea (Salir). En la pantalla del PIN toca **Olvidé mi PIN**, escribe el código del
    paso 2 y pon un PIN nuevo. Entra con el nuevo.

### Modo demostración (aparte)
22. Esto **borra** tu negocio de prueba, así que hazlo al final: desinstala la app, vuelve a
    instalarla y en la primera pantalla toca **Probar con datos de ejemplo**. Debe abrir una
    bodega con 20 productos y una franja amarilla "DEMOSTRACIÓN" en todas las pantallas.
23. Inicio → **Borrar demostración y empezar mi negocio**: vuelve a la primera pantalla, con
    el catálogo vacío.

## 4. Qué mandarme
- La lista con ✅/❌ por número de paso.
- Capturas de lo que falle y de un ticket de cada flujo (pasos 8, 9 y 10).
- Modelo del celular y versión de Android.
- Cualquier palabra que el tendero no entendería.

El PR #2 queda **sin fusionar** hasta revisar esta prueba.
