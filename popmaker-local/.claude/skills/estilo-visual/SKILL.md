---
name: estilo-visual
description: Estilo visual de la marca. Úsala siempre que escribas la sección "Imagen sugerida" de un guion, un prompt de imagen, llames a mcp-media-toolkit o revises si una imagen encaja con la marca. Define paleta, tipo de imagen, referencias, elementos a evitar y el prompt base de estilo.
---

# Estilo visual

<!-- Decisión de diseño: el "Prompt base" se añade automáticamente al generar
(scripts/generate_images.py lo lee de este archivo). Los guiones solo describen la
escena; así, si cambias el estilo, regeneras las imágenes sin reescribir guiones.
Edita lo que esté entre [CORCHETES]. -->

## Paleta de colores

| Rol        | Color                | Uso                                   |
| ---------- | -------------------- | ------------------------------------- |
| Primario   | `[COLOR_PRIMARIO]`   | Sujeto principal y acentos            |
| Secundario | `[COLOR_SECUNDARIO]` | Detalles y apoyo                      |
| Fondo      | `[COLOR_FONDO]`      | Fondos lisos o degradados suaves      |

Escribe cada color con nombre y hex, ej.: `deep teal (#0F5257)`.

## Tipo de imagen

- **Tipo:** `[TIPO_DE_IMAGEN]` (ilustración flat, fotorrealismo editorial, 3D suave, collage…)
- **Iluminación:** `[ILUMINACION]` (luz natural suave, estudio con contraluz…)
- **Acabado:** `[ACABADO]` (limpio, grano de película sutil, mate…)

## Referencias de estilo

- Estética: `[REFERENCIA_DE_ESTILO]` (minimalismo escandinavo, Bauhaus, Y2K…)
- Artistas / marcas con un look parecido: `[REFERENCIA_ARTISTA_O_MARCA]`
- Imágenes propias: `data/referencias/`

En el prompt, traduce las referencias a rasgos concretos (paleta, trazo, composición)
en vez de nombrar a artistas vivos.

## Elementos a evitar

- Texto dentro de la imagen (los modelos lo deforman): el texto va en el copy.
- Logos de terceros y personas reales reconocibles.
- `[ELEMENTO_A_EVITAR]`

## Cómo escribir la "Imagen sugerida"

Ver `config/prompts/image_prompt.md`: en inglés, sujeto + escena + composición + emoción,
sin colores ni estilo (los pone el prompt base).

## Prompt base

Edita solo el texto entre los dos comentarios `prompt-base`; no borres los comentarios.

<!-- prompt-base:inicio -->
Style: [TIPO_DE_IMAGEN], [REFERENCIA_DE_ESTILO]. Color palette: primary [COLOR_PRIMARIO], secondary [COLOR_SECUNDARIO], background [COLOR_FONDO]. Lighting: [ILUMINACION]. Finish: [ACABADO]. Clean composition with generous negative space. No text, no letters, no logos, no watermarks.
<!-- prompt-base:fin -->
