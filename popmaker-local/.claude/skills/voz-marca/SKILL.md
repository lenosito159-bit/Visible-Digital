---
name: voz-marca
description: Voz y tono de la marca para cualquier texto publicable (guiones de YouTube y TikTok, carruseles de Instagram, posts de LinkedIn, captions). Úsala siempre que redactes o revises copy de contenido.
---

# Voz de marca

<!-- Decisión de diseño: los datos (tono, palabras prohibidas, longitudes) viven en
config/brand_voice.yaml para que los scripts sin Claude también los usen. Esta skill
añade el criterio: cómo aplicarlos. Para cambiar la voz, edita el YAML. -->

Lee siempre `config/brand_voice.yaml` antes de escribir. Si algo de aquí choca con
el YAML, manda el YAML.

## Tono

Aplica `tono.registro`, `tono.persona`, `tono.humor` y `tono.emojis` del YAML.
Usa con naturalidad (no en cada pieza) las expresiones de `sello`.
- Frases cortas. Verbos concretos. Un ejemplo real vale más que tres adjetivos.

## Estructura de contenido

1. **Hook**: primera línea o primeros 3 segundos. Máx. 15 palabras. Tipos que
   funcionan: dato sorprendente, error común, pregunta incómoda, antes/después.
2. **Desarrollo**: una sola idea central, con un ejemplo concreto.
3. **CTA**: una sola acción (en carrusel, la de `estructura.instagram_carrusel.slide_final`).

## Longitud por plataforma

Usa `estructura.<formato>` de `config/brand_voice.yaml` cuando exista (ej. `instagram_carrusel`:
7-9 slides, máx. 15 palabras por slide). Para el resto de formatos, `longitud` y `estructura`
de `config/plataformas.yaml` (YouTube, Instagram, LinkedIn, TikTok).

## Palabras y frases a evitar

Las de `prohibidas` del YAML, más:
- Exclamaciones en cadena ("¡¡…!!") y más emojis de los que permite `tono.emojis`.

## Ejemplos de estilo

Los textos de `ejemplos` del YAML son la referencia principal de la voz: imita su ritmo
(frases cortas, dato concreto, giro final), no su contenido.

**Así no:**
> "¡¡En el mundo actual tener un portfolio es clave!! 🚀🚀🚀"

## Checklist antes de guardar

- [ ] El hook funciona leído solo.
- [ ] Una idea central y una CTA.
- [ ] Longitud dentro del rango de la plataforma.
- [ ] Ninguna palabra prohibida.
