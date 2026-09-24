---
name: generador-ideas
description: Genera ideas de contenido nuevas a partir de un tema semilla, sin repetir las del banco de ideas (data/ideas/) y apoyándose en las referencias (data/referencias/). Úsala cuando el usuario pida ideas, un calendario de contenido o ejecute /generar-contenido.
---

# Generador de ideas

## Entradas

- **Tema semilla**: lo da el usuario (ej.: "productividad para freelancers").
- **N**: número de ideas. Por defecto, `ideas_por_defecto` de `config/brand_voice.yaml` (5).
- **Plataformas**: las que indique el usuario o, si no, las activas en `config/plataformas.yaml`.

## Proceso

### 1. Reunir contexto

Ejecuta:

```bash
python3 scripts/generate_ideas.py contexto --tema "<tema semilla>"
```

Devuelve los títulos ya existentes en `data/ideas/`, los archivos de
`data/referencias/` y las ideas previas más parecidas al tema. Lee también las
referencias que parezcan relevantes.

### 2. Analizar el tema semilla

Antes de proponer nada, escribe para ti:

- El **problema o deseo** de la audiencia (ver skill `voz-marca`) que toca el tema.
- 3-5 **subtemas** o tensiones dentro del tema.
- Qué ángulos **ya están cubiertos** en el banco de ideas.

### 3. Generar N ideas

Sigue `config/prompts/idea_prompt.md`. Cada idea incluye:

- **Título tentativo**: como lo leería la audiencia, no como una etiqueta interna.
- **Ángulo único**: qué la diferencia de lo que ya hay (en el banco y en general).
- **Plataforma objetivo**: una, de `config/plataformas.yaml`.
- **Formato**: carrusel, vídeo corto, hilo, post, artículo…
- **Hook propuesto**: la primera frase.
- **Por qué funcionaría**: 1-2 frases con la razón (dolor concreto, curiosidad, dato, tendencia, contraste).

Varía los ángulos: mezcla al menos tres tipos entre error común, tutorial paso a
paso, opinión contraria, caso real, comparativa, lista, mito vs. realidad y
detrás de cámaras.

### 4. Evitar duplicados

Descarta o reformula cualquier idea cuyo título o ángulo se parezca a uno del banco.
El script lo comprueba al guardar; si marca una como duplicada, sustitúyela.

### 5. Guardar

Escribe las ideas en un archivo temporal con el formato de abajo y guárdalas con:

```bash
python3 scripts/generate_ideas.py guardar --tema "<tema semilla>" --archivo <archivo_temporal.md>
```

El script las añade a `data/ideas/YYYY-MM-DD_ideas.md` (creándolo si no existe),
les asigna un ID (`YYYYMMDD-NN`) y avisa de posibles duplicados.

## Formato de cada idea

```markdown
### <Título tentativo>
- **Ángulo:** ...
- **Plataforma:** instagram
- **Formato:** carrusel
- **Hook:** ...
- **Por qué funcionaría:** ...
```

Usa exactamente estas etiquetas: el script las lee para detectar duplicados.
