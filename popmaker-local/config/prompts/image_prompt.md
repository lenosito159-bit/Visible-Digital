# Prompt: descripciones de imagen

Escribe cada bloque `image-prompt` del guion siguiendo la skill `estilo-visual`.

**Mensaje de la pieza:** {{hook}}
**Plataforma:** {{plataforma}} (aspect ratio {{aspect_ratio}})
**Papel de la imagen:** {{papel}}   <!-- portada | apoyo | escena N -->

## Plantilla (en inglés)

```
<Sujeto concreto>, <acción o estado>. <Escena: lugar y objetos clave>.
<Composición: encuadre, dónde está el sujeto, espacio negativo para texto si es portada>.
<Emoción o sensación que debe transmitir>.
```

## Reglas

- Concreto antes que abstracto: "a cluttered desk with three open laptops" mejor que "chaos".
- La portada deja espacio negativo (arriba o a un lado) para el título que se añadirá en edición.
- Las imágenes de un mismo guion comparten sujeto o escenario para que la serie sea coherente.
- NO incluyas el prompt base de estilo: se añade automáticamente al generar.
- Nada de texto dentro de la imagen, logos ni personas reales reconocibles.

## Ejemplo

```image-prompt
A freelance designer sitting cross-legged on a sofa, looking relieved at a laptop showing a simple calendar. Warm living room with plants and a mug of coffee on a low table. Medium shot, subject on the right third, empty wall on the left for a headline. Feeling of calm control after chaos.
```
