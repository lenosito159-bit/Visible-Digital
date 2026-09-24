---
name: voz-marca
description: Voz y tono de la marca para cualquier texto publicable (guiones de YouTube y TikTok, carruseles de Instagram, posts de LinkedIn, captions). Úsala siempre que redactes o revises copy de contenido.
---

# Voz de marca

<!-- Decisión de diseño: los datos (tono, palabras prohibidas, longitudes) viven en
config/brand_voice.yaml para que los scripts sin Claude también los usen. Esta skill
añade el criterio: cómo aplicarlos y ejemplos. Edita lo que esté entre [CORCHETES]. -->

Lee siempre `config/brand_voice.yaml` antes de escribir. Si algo de aquí choca con
el YAML, manda el YAML.

## Tono

- **Tono principal:** `[TONO]` (cercano / profesional / técnico / irreverente / inspirador)
- **Trato:** `[TUTEO_O_USTED]`
- **Somos...** `[RASGO_1]`, pero no `[EXCESO_1]` (ej.: directos, pero no bordes);
  `[RASGO_2]`, pero no `[EXCESO_2]` (ej.: expertos, pero no pedantes).
- Frases cortas. Verbos concretos. Un ejemplo real vale más que tres adjetivos.

## Estructura de contenido

1. **Hook**: primera línea o primeros 3 segundos. Máx. 15 palabras. Tipos que
   funcionan: dato sorprendente, error común, pregunta incómoda, antes/después.
2. **Desarrollo**: una sola idea central, con un ejemplo concreto.
3. **CTA**: una sola acción, de la lista `estructura.cta` del YAML.

## Longitud por plataforma

Usa `longitud_por_plataforma` de `config/brand_voice.yaml` y la `estructura` de
`config/plataformas.yaml` (YouTube, Instagram, LinkedIn, TikTok).

## Palabras y frases a evitar

Las de `palabras_prohibidas` del YAML, más:
- Exclamaciones en cadena ("¡¡…!!") y más de `tono.max_emojis` emojis.
- `[FRASE_A_EVITAR]`

## Ejemplos de estilo

Sustitúyelos por textos reales de tu marca: son la referencia más fiable.

**Así sí:** `[EJEMPLO_BUENO]`
> (ej.: "El 80 % de los portfolios que reviso tienen el mismo fallo: enseñan todo.
> Hoy te cuento por qué 6 proyectos venden más que 30.")

**Así no:** `[EJEMPLO_MALO]`
> (ej.: "¡¡En el mundo actual tener un portfolio es clave!! 🚀🚀🚀")

## Checklist antes de guardar

- [ ] El hook funciona leído solo.
- [ ] Una idea central y una CTA.
- [ ] Longitud dentro del rango de la plataforma.
- [ ] Ninguna palabra prohibida.
