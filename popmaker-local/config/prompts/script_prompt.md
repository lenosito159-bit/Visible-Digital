<!--
Plantilla del guion. La sigue Claude en /generar-contenido.
La sección "## Imagen sugerida" es el contrato con el hook y con
scripts/generate_images.py: no cambies su título.
-->
# Instrucciones para el guion

Convierte la idea en una pieza lista para publicar siguiendo la skill `voz-marca`,
`config/brand_voice.yaml` (tono, palabras prohibidas, longitud) y la entrada de la
plataforma en `config/plataformas.yaml` (formato, estructura).

Reglas: una sola idea central, una sola CTA. Si toca CTA de **oferta**, la pieza aporta
valor por sí sola y cierra presentando la oferta de `brand_voice.yaml` (nombre, beneficio
concreto y enlace exacto), sin tono de anuncio. Si toca **audiencia**: guardar, compartir o seguir. Longitud: la de `estructura.<formato>` en
`config/brand_voice.yaml` si existe (ej. `instagram_carrusel`); si no, la de `config/plataformas.yaml`.

# Formato del archivo

Ruta: `data/output/guiones/YYYY-MM-DD_<plataforma>_<slug-del-titulo>.md`

```markdown
---
idea_id: <ID de la idea, ej. 20260924-01>
titulo: <título final>
plataforma: <youtube | instagram | linkedin | tiktok>
cta: <audiencia | oferta>   # lo indica `generate_ideas.py contexto` ("CTA de las próximas piezas")
fecha: YYYY-MM-DD
---

# <Título final>

## Hook
<primera línea / primeros segundos>

## Desarrollo
<cuerpo. YouTube y TikTok: "### Escena N" con [PLANO], [TEXTO EN PANTALLA] y [VOZ].
Instagram: "### Slide N". LinkedIn: párrafos cortos.>

## CTA
<una sola llamada a la acción>

## Copy de publicación
<texto que acompaña a la publicación, con hashtags>

## Imagen sugerida
<UNA descripción en inglés de la imagen: sujeto, escena, composición y emoción.
Sin el prompt base de estilo: se añade automáticamente al generar.>
```
