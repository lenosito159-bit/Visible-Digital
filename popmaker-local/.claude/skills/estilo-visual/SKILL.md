---
name: estilo-visual
description: Guía de estilo visual de la marca. Úsala SIEMPRE que vayas a escribir un prompt de imagen, llamar a una herramienta de generación de imágenes (mcp-media-toolkit) o revisar si una imagen encaja con la marca. Define paleta, tipo de imagen, referencias, elementos prohibidos y el prompt base que se añade a toda descripción de imagen.
---

# Estilo visual de la marca

> Edita los valores entre corchetes (`[ASÍ]`). El script `scripts/generate_images.py`
> lee el bloque "Prompt base" de este archivo: edita el texto entre los dos
> comentarios `prompt-base` pero no borres los comentarios.

## Paleta de colores

| Rol        | Color                  | Uso                                        |
| ---------- | ---------------------- | ------------------------------------------ |
| Primario   | `[COLOR_PRIMARIO]`     | Sujeto principal, acentos, elementos clave |
| Secundario | `[COLOR_SECUNDARIO]`   | Detalles, sombras de color, apoyo          |
| Fondo      | `[COLOR_FONDO]`        | Fondos lisos o degradados suaves           |
| Acento     | `[COLOR_ACENTO]`       | Opcional: un solo punto de atención        |

Describe los colores en el prompt con palabras y código hex, por ejemplo
"deep teal (#0F5257)". Los modelos respetan mejor ambos juntos.

## Tipo de imagen

- **Tipo principal:** `[TIPO_DE_IMAGEN]` (ej.: ilustración flat, fotorrealismo editorial, 3D render suave, collage)
- **Encuadre preferido:** `[ENCUADRE]` (ej.: plano medio, cenital, primer plano)
- **Iluminación:** `[ILUMINACION]` (ej.: luz natural suave, estudio con contraluz)
- **Textura / acabado:** `[ACABADO]` (ej.: grano de película sutil, mate, limpio)

## Referencias de estilo

- Estética: `[REFERENCIA_DE_ESTILO]` (ej.: minimalismo escandinavo, Bauhaus, Y2K)
- Artistas o estudios: `[REFERENCIA_ARTISTA]`
- Marcas con un look parecido: `[REFERENCIA_MARCA]`
- Imágenes propias de referencia: `data/referencias/` (míralas antes de escribir prompts si existen)

No copies el estilo de un artista vivo por su nombre en el prompt final: tradúcelo a
rasgos concretos (paleta, trazo, composición).

## Elementos a evitar

- Texto dentro de la imagen (los modelos lo deforman). El texto va en el copy.
- Logotipos o marcas de terceros.
- Caras de personas reales reconocibles.
- `[ELEMENTO_PROHIBIDO_1]`
- `[ELEMENTO_PROHIBIDO_2]`

## Prompt base

Toda imagen que se genere lleva este bloque al final, después del sujeto y la escena.

- En los guiones (`data/output/*.md`), los bloques `image-prompt` llevan **solo** sujeto,
  escena y emoción. El prompt base se añade al generar (lo hacen el hook y
  `scripts/generate_images.py`), así puedes cambiar el estilo y regenerar sin tocar los guiones.
- Si llamas a mcp-media-toolkit a mano, pega tú el bloque al final del prompt.

<!-- prompt-base:inicio -->
Style: [TIPO_DE_IMAGEN], [REFERENCIA_DE_ESTILO]. Color palette: primary [COLOR_PRIMARIO], secondary [COLOR_SECUNDARIO], background [COLOR_FONDO]. Lighting: [ILUMINACION]. Finish: [ACABADO]. Clean composition with generous negative space. No text, no letters, no logos, no watermarks.
<!-- prompt-base:fin -->

## Cómo escribir un prompt de imagen

1. **Sujeto**: qué se ve, en concreto ("una taza de café humeante sobre un portátil abierto").
2. **Escena y composición**: dónde está, encuadre, qué ocupa cada tercio.
3. **Emoción**: qué debe sentir quien la ve, ligado al mensaje del guion.
4. **Prompt base**: pega el bloque de arriba.

Escribe los prompts en inglés: los modelos de Gemini siguen mejor las instrucciones
visuales en inglés. El resto del contenido sigue en español.

## Formato según plataforma

Usa el `aspect_ratio` indicado en `config/plataformas.yaml`. Valores que admite
mcp-media-toolkit: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`.
