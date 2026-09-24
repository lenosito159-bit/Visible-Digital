---
name: generador-ideas
description: Genera ideas de contenido nuevas a partir de un tema semilla, sin repetir las del banco (data/ideas/) y apoyándose en las referencias (data/referencias/). Úsala cuando el usuario pida ideas de contenido o ejecute /generar-contenido.
---

# Generador de ideas

<!-- Decisión de diseño: Claude escribe las ideas (mejor criterio) y el script
scripts/generate_ideas.py las guarda y detecta duplicados (reglas deterministas).
El mismo script puede generar ideas sin Claude: `generate_ideas.py generar`. -->

## Entradas

- **Tema semilla** (obligatorio).
- **Cantidad N** de ideas (por defecto 3; en `/generar-contenido`, `--cantidad`).
- **Plataforma**: una clave de `config/plataformas.yaml`.

## Proceso

1. **Contexto**: ejecuta
   `python3 scripts/generate_ideas.py contexto --tema "<tema>"`.
   Lista las ideas existentes (las más parecidas al tema primero) y los archivos de
   `data/referencias/`. Lee las referencias que parezcan relevantes.

2. **Análisis del tema**: identifica el problema o deseo de la audiencia (skill
   `voz-marca`), 3-5 subtemas y qué ángulos ya están cubiertos en el banco.

3. **Generar N ideas** con el formato de `config/prompts/idea_prompt.md`:
   título tentativo, ángulo único, plataforma objetivo, hook y por qué funcionaría.
   Ángulos variados: error común, tutorial, opinión contraria, caso real, comparativa,
   lista, mito vs. realidad.

4. **Guardar**: escribe las ideas en un archivo temporal (ej. `/tmp/ideas.md`) y ejecuta
   `python3 scripts/generate_ideas.py guardar --tema "<tema>" --archivo /tmp/ideas.md`.
   Se añaden a `data/ideas/YYYY-MM-DD_ideas.md` con un ID (`YYYYMMDD-NN`).

5. **Duplicados**: si el script descarta alguna por parecerse a una existente, propón
   otra con un ángulo distinto y vuelve a guardar (máximo 2 intentos).

## Formato de cada idea

```markdown
### <Título tentativo>
- **Ángulo:** <qué la hace distinta>
- **Plataforma:** <plataforma>
- **Hook:** <primera frase, máx. 15 palabras>
- **Por qué funcionaría:** <1-2 frases>
```
