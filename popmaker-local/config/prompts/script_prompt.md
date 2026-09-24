# Prompt: guion / texto

Convierte la idea en una pieza lista para publicar, siguiendo la skill `voz-marca`,
`config/brand_voice.yaml` y la especificación de la plataforma en
`config/plataformas.yaml`.

**Idea:** {{idea}}
**Plataforma:** {{plataforma}}  ·  **Formato:** {{formato}}

## Reglas

- Una sola idea central y una sola CTA (elige una de `estructura.cta.opciones`).
- Respeta la longitud de la plataforma.
- Hook: el propuesto en la idea, mejorado si hace falta (máx. 15 palabras).
- Ningún término de `evitar`.

## Estructura del archivo de salida

Guarda en `data/output/YYYY-MM-DD_<slug>.md` con exactamente esta forma:

````markdown
---
idea_id: <ID de la idea, ej. 20260924-03>
titulo: <título final>
plataforma: <instagram | tiktok | linkedin | x | blog>
formato: <carrusel | video_corto | post | hilo | articulo>
aspect_ratio: <el de la plataforma>
fecha: YYYY-MM-DD
estado: borrador
---

# <Título final>

## Hook
<hook>

## Desarrollo
<cuerpo; en carrusel, una sección "### Slide N" por slide;
en vídeo, "### Escena N" con [PLANO], [TEXTO EN PANTALLA] y [VOZ]>

## CTA
<cta>

## Copy de publicación
<caption / texto del post con hashtags>

## Prompts de imagen

```image-prompt
<prompt 1: sujeto, escena, composición y emoción, en inglés. SIN el prompt base>
```

```image-prompt
<prompt 2…>
```
````

Usa tantos bloques `image-prompt` como `imagenes` indique la plataforma (sin superar
`pipeline.imagenes_por_guion`). El primero es la portada.
