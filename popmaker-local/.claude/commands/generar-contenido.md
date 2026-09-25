---
description: Pipeline de contenido - ideas, guiones e imágenes a partir de un tema
argument-hint: --tema "<tema>" [--plataforma linkedin] [--cantidad 1] [--solo-texto] [--dry-run]
allowed-tools: Read, Write, Edit, Glob, Grep, Skill, Bash(python3 scripts/generate_ideas.py:*), Bash(python3 scripts/generate_images.py:*), Bash(python3 scripts/validar_guion.py:*), Bash(python3 scripts/metricas.py:*), mcp__mcp-media-toolkit__generate_image_gemini, mcp__mcp-media-toolkit__generate_and_upload_gemini_s3
---

<!--
Decisiones de diseño:
- La imagen NO la genera Claude en este comando: al escribir el guion con Write, el hook
  PostToolUse la genera vía MCP y deja la URL en un .txt. Así hay un único camino para
  crear imágenes (el mismo que usa cron) y no se generan dos veces.
- --cantidad = número de piezas completas (idea + guion + imagen). Empezamos simple:
  una idea -> un guion -> una imagen.
-->

# Generar contenido

Argumentos: `$ARGUMENTS`

## 0. Argumentos

- `--tema "<texto>"` (obligatorio). Si no viene `--tema`, usa como tema el texto suelto; si
  no hay nada, pide el tema y para.
- `--plataforma <p>`: una de las claves de `config/plataformas.yaml` (youtube, instagram,
  linkedin, tiktok). Por defecto `linkedin`.
- `--cantidad <n>`: número de piezas. Por defecto `1`.
- `--solo-texto`: ideas y guiones, sin imágenes.
- `--dry-run`: no escribas archivos, no llames a APIs y no generes texto: solo muestra el plan.

## 1. Cargar skills

Carga las skills **voz-marca** y **estilo-visual** (herramienta Skill) y lee
`config/brand_voice.yaml` y la entrada de la plataforma en `config/plataformas.yaml`.

**Si `--dry-run`**, muestra y termina:
- los parámetros interpretados;
- la salida de `python3 scripts/generate_ideas.py contexto --tema "<tema>" --cantidad <n>`
  (banco, métricas, plan de CTA y referencias);
- las rutas que se crearían: `data/ideas/<hoy>_ideas.md`,
  `data/output/guiones/<hoy>_<plataforma>_<slug>.md` (+ `.txt`) y
  `data/output/imagenes/<hoy>_<plataforma>_<slug>.png`;
- el aspect ratio y el prompt base que se usarían (y si tiene placeholders sin rellenar);
- `python3 scripts/generate_images.py --pendientes --dry-run` si hay guiones pendientes.

## 2. Ideas

Usa la skill **generador-ideas** para generar `--cantidad` ideas del tema para esa
plataforma y guardarlas en `data/ideas/`. Pasa `--cantidad <n>` a `contexto`: su sección
"CTA de las próximas piezas" dice qué pieza lleva CTA de oferta.

## 3. Guion por idea

Para cada idea guardada, escribe el guion siguiendo `config/prompts/script_prompt.md`
y la skill **voz-marca**. La sección `## Imagen sugerida` sigue
`config/prompts/image_prompt.md` y la skill **estilo-visual** (solo la escena, en inglés;
el prompt base se añade al generar).

Escribe el guion **completo, incluida `## Imagen sugerida`, en una sola llamada a Write**
(no Bash) en `data/output/guiones/YYYY-MM-DD_<plataforma>_<slug>.md`. El slug: 3-6 palabras
clave del título, en minúsculas, sin tildes y con guiones (ej. `rutina-5am-9-dias`).

Antes de guardar, cuenta las palabras de cada slide: el límite de `longitud_por_slide`
es estricto.

Si `--solo-texto`, omite la sección `## Imagen sugerida`: sin ella el hook no genera nada.

## 4-6. Validación e imagen (automáticas)

Al escribir el guion, el hook `.claude/hooks/on-write-generate-image.sh`:
- valida el estilo con `scripts/validar_guion.py` (slides, palabras por slide, expresiones
  prohibidas). Si informa de problemas, corrígelos con Edit (el hook vuelve a validar);
- extrae la descripción de `## Imagen sugerida`, le añade el prompt base de estilo, llama
al MCP de imágenes y guarda:
- la imagen en `data/output/imagenes/<mismo nombre>.png`
- la URL en `data/output/guiones/<mismo nombre>.txt`

Verás su resultado como contexto "[hook popmaker OK/REVISAR]". Si no aparece el `.txt`
(hooks desactivados o fallo), ejecuta `python3 scripts/generate_images.py <guion>` una vez.
No reintentes más: informa del error.

## 7. Resumen

Termina con una tabla: ID de idea, título, ruta del guion, resultado de la validación de
estilo y URL de la imagen (primera línea del `.txt`) o el error. Si el hook avisó de placeholders sin rellenar en el prompt
base, recuérdalo.
