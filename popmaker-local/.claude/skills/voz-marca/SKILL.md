---
name: voz-marca
description: Voz y tono de la marca para cualquier texto publicable (guiones, posts, captions, hilos, newsletters). Úsala siempre que redactes o revises copy de contenido, junto con config/brand_voice.yaml y config/plataformas.yaml.
---

# Voz de marca

> Edita los valores entre corchetes (`[ASÍ]`). Los datos estructurados (longitudes,
> hashtags, CTA) viven en `config/brand_voice.yaml` y `config/plataformas.yaml`.
> Si algo choca, manda el YAML.

## Quiénes somos

- **Marca:** `[NOMBRE_MARCA]`
- **Qué hacemos:** `[PROPUESTA_DE_VALOR]`
- **Para quién:** `[AUDIENCIA_OBJETIVO]` (ej.: freelancers creativos de 25-40 años que empiezan a vender online)
- **Qué queremos que hagan:** `[OBJETIVO_PRINCIPAL]` (ej.: suscribirse a la newsletter)

## Tono

- **Tono principal:** `[TONO]` (cercano / profesional / técnico / irreverente / inspirador)
- **Persona gramatical:** `[TUTEO_O_USTED]` (tú / usted / vosotros)
- **Nivel técnico:** `[NIVEL_TECNICO]` (divulgativo / intermedio / experto)
- **Humor:** `[HUMOR]` (nada / guiños puntuales / protagonista)
- **Somos... pero no...**
  - `[RASGO_1]`, pero no `[EXCESO_1]` (ej.: directos, pero no bordes)
  - `[RASGO_2]`, pero no `[EXCESO_2]` (ej.: expertos, pero no pedantes)

## Estructura de contenido

Todo contenido sigue tres bloques:

1. **Hook (gancho)**: la primera línea o los primeros 3 segundos. Debe crear
   curiosidad, tensión o reconocimiento. Tipos que funcionan: dato sorprendente,
   pregunta incómoda, error común, contraste antes/después, promesa concreta.
2. **Desarrollo**: una sola idea por pieza. Frases cortas. Un ejemplo concreto vale
   más que tres adjetivos. En vídeo: marca cambios de plano o de ritmo.
3. **CTA (llamada a la acción)**: una sola acción, clara y coherente con la
   plataforma. Usa las CTA de `config/brand_voice.yaml`.

## Longitud objetivo por plataforma

La referencia exacta está en `config/plataformas.yaml`. Resumen por defecto:

| Plataforma | Formato              | Longitud                  |
| ---------- | -------------------- | ------------------------- |
| Instagram  | Carrusel / post      | 5-10 slides, caption ≤ 150 palabras |
| TikTok     | Vídeo vertical       | 30-60 s (≈ 80-150 palabras de guion) |
| LinkedIn   | Post de texto        | 150-300 palabras          |
| X          | Hilo                 | 4-8 tuits de ≤ 280 caracteres |
| Blog       | Artículo             | 800-1500 palabras         |

## Palabras y frases a evitar

- "En el mundo actual…", "Hoy en día…", "En la era digital…"
- "Sinergia", "disruptivo", "revolucionario", "game changer"
- "¡No te lo pierdas!" y signos de exclamación en cadena
- Emojis en exceso (máximo `[MAX_EMOJIS]` por pieza)
- `[PALABRA_PROHIBIDA_1]`
- `[PALABRA_PROHIBIDA_2]`

## Palabras y expresiones de la casa

- `[EXPRESION_PROPIA_1]`
- `[EXPRESION_PROPIA_2]`

## Ejemplos de estilo

Sustituye estos ejemplos por textos reales de tu marca: son la referencia más fiable.

**Así sí:**

> `[EJEMPLO_BUENO_1]`
> (ej.: "El 80 % de los portfolios que reviso tienen el mismo fallo: enseñan todo.
> Hoy te cuento por qué 6 proyectos venden más que 30.")

**Así no:**

> `[EJEMPLO_MALO_1]`
> (ej.: "¡¡En el mundo actual tener un portfolio es clave!! 🚀🚀🚀 Descubre cómo
> revolucionar tu presencia digital.")

## Checklist antes de guardar

- [ ] El hook funciona leído solo, sin contexto.
- [ ] Hay una sola idea central y una sola CTA.
- [ ] Respeta la longitud de la plataforma.
- [ ] No aparece ninguna palabra de la lista de evitar.
- [ ] Suena como los ejemplos de "Así sí".
