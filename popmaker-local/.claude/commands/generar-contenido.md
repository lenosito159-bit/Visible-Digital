---
description: Pipeline completo - ideas, guiones e imágenes a partir de un tema semilla
argument-hint: "<tema> [--n 5] [--plataforma instagram] [--guiones 1] [--sin-imagenes]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(python3 scripts/generate_ideas.py:*), Bash(python3 scripts/generate_images.py:*), mcp__mcp-media-toolkit__generate_image_gemini, mcp__mcp-media-toolkit__generate_and_upload_gemini_s3
---

# Generar contenido

Argumentos recibidos: `$ARGUMENTS`

## 0. Interpretar argumentos

- **Tema**: todo el texto que no sea una opción. Si está vacío, pide el tema y para.
- `--n N`: número de ideas. Por defecto `pipeline.ideas_por_defecto` de `config/brand_voice.yaml`.
- `--plataforma P`: limita las ideas a esa plataforma (puede repetirse). Por defecto,
  las que tienen `activa: true` en `config/plataformas.yaml`.
- `--guiones G`: cuántas ideas se desarrollan como guion. Por defecto `pipeline.guiones_por_defecto`.
- `--sin-imagenes`: escribe los bloques `image-prompt` pero no generes imágenes.

Lee `config/brand_voice.yaml` y `config/plataformas.yaml` antes de seguir.

## 1. Ideas

Usa la skill **generador-ideas** con el tema, N y las plataformas. Al terminar deben
estar guardadas en `data/ideas/YYYY-MM-DD_ideas.md` con sus IDs.

## 2. Selección

Elige las G ideas con más potencial (hook más fuerte, ángulo más diferente del banco)
y explica la elección en una línea por idea.

## 3. Guiones

Para cada idea elegida, usa la skill **voz-marca** y sigue
`config/prompts/script_prompt.md`. Escribe los bloques `image-prompt` siguiendo la skill
**estilo-visual** y `config/prompts/image_prompt.md`.

Guarda cada guion con la herramienta Write en `data/output/YYYY-MM-DD_<slug>.md`
(slug en minúsculas, sin tildes, con guiones). Si `--sin-imagenes`, añade
`imagenes: no` al frontmatter.

## 4. Imágenes

Al guardar un guion, el hook `on-write-generate-image.sh` se dispara solo:

- Modo `mcp` (por defecto): te devuelve los prompts completos (con el prompt base) y
  las instrucciones. Síguelas: llama a la herramienta de mcp-media-toolkit una vez por
  prompt y después añade la sección "Imágenes generadas" al guion.
- Modo `script`: el hook genera las imágenes con `scripts/generate_images.py` y te
  informa del resultado.
- Modo `off` o `imagenes: no`: no se generan imágenes.

Si el hook no se ha ejecutado (por ejemplo, hooks desactivados), genera las imágenes
tú con `python3 scripts/generate_images.py prompts <guion>` y la herramienta MCP.

## 5. Resumen final

Termina con una tabla: ID de idea, título, plataforma, ruta del guion y nº de imágenes
(o el error si alguna falló). Lista también las ideas no desarrolladas con su ID para
retomarlas más tarde.
