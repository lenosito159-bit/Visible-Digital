# Estado de las pruebas

Leyenda: ✅ verificado · 🟡 hecho y probado en la computadora, **falta el celular** · ⬜ pendiente.

| Área | Estado | Dónde se verificó |
|---|---|---|
| Compila y tipa (shared, backend, mobile) | ✅ | Computadora y CI |
| Lógica del celular: ventas y los 3 cobros, inventario, caja, fiados, abonos | 🟡 | Tests sobre el SQLite de Node |
| Todo o nada, sin duplicados, cerrar y volver a abrir | 🟡 | Tests (falla simulada a la mitad, reintentos, base en archivo) |
| Ticket interno (sin RUC; Yape "confirmado manualmente") | 🟡 | Tests en texto y HTML |
| Informes y avisos | 🟡 | Tests |
| Copia con contraseña, comprobación y recuperación | 🟡 | Tests (recuperación en otra base, contraseña equivocada, archivo cambiado, falla a la mitad) |
| Bundle de Android arma | ✅ | `expo export` (3.6 MB) |
| **Pantallas en un Android real** | ⬜ | Nadie todavía: falta el APK |
| **Menú de compartir, selector de archivos, fotos, notificaciones** | ⬜ | Solo existen en el celular |
| **Desinstalar y recuperar una copia en el celular** | ⬜ | [`PRUEBA-APK.md`](PRUEBA-APK.md), parte A |
| **Tiempo de cifrar/abrir la copia en gama baja** | ⬜ | Medido solo en la computadora (~0.3 s); en el celular será más |

**La app no está lista para una tienda** hasta que las filas ⬜ estén en ✅.

## Comandos (desde `perupos/`)

```bash
npm ci
npm run typecheck
npm test -w @perupos/shared      # lógica del celular (sin PostgreSQL)
npm test -w @perupos/backend     # módulo de servidor (PostgreSQL; borra perupos_test)
cd mobile && EAS_BUILD_PROFILE=preview npx expo export --platform android --output-dir /tmp/bundle
```

## Qué cubren los tests de la app (`shared/test/local-*.test.ts`)

- **Acceso:** primera configuración sin RUC, PIN (5 intentos y espera), código de recuperación,
  ayudantes, migraciones de la base.
- **Ventas:** los 3 flujos (efectivo + Yape; efectivo + Yape + fiado; "te yapeo 40, dame el
  vuelto"), Yape sin confirmar o "verificado" rechazado, N° de operación repetido, límite de
  fiado y descuento con PIN del dueño, a granel, anulación.
- **Garantías:** falla a la mitad de venta/abono/cierre sin guardar nada; reintentos sin
  duplicar; base en archivo cerrada y abierta otra vez con todo igual; ninguna transacción
  dentro de otra.
- **Caja, fiados, abonos, informes (hora de Lima), avisos y notificar una sola vez.**
- **Ticket interno:** contenido de los 3 flujos, 32 columnas, sin ninguna palabra tributaria.
- **Copia:** recuperación completa en otra base (PIN, código, ventas, stock, deudas, cuaderno,
  caja, numeración), reemplazo sin restos, archivo editado/cortado/ajeno/más nuevo rechazado,
  falla a la mitad; contraseña equivocada, archivo cifrado alterado, contraseña corta, sal y
  nonce al azar, copias antiguas sin contraseña, "copia hecha" ≠ "copia comprobada".
- **La guía del APK:** `shared/test/guia-demo.test.ts` hace la parte A de `PRUEBA-APK.md` paso
  a paso con la demostración y comprueba sus números (caja S/ 132.30, stock, deudas, foto,
  numeración y N° de operación tras recuperar). Si la guía y la app no coinciden, falla.
- Se comprobó que los tests detectan errores rompiendo a propósito el cálculo de la caja y
  quitando las transacciones de la venta y de la recuperación.

## Qué NO cubren
- Nada de lo que solo existe en el celular: pantallas, `expo-sqlite` real, menú de compartir,
  selector de archivos, cámara, notificaciones, impresión.
- Rendimiento en un celular de gama baja.

## CI
Dos workflows en GitHub (`api-tests.yml` y `perupos.yml`), con 4 checks en total. El
de PeruPOS corre `npm ci`, `npm run typecheck` y `npm test` (shared + backend con PostgreSQL).
