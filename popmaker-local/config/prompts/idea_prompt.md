<!--
Plantilla para generar ideas. La usan:
  - scripts/generate_ideas.py (modo sin Claude, con Gemini): sustituye las {{variables}}.
  - la skill generador-ideas (con Claude), como guía del formato de salida.
No cambies el "Formato de salida": el script lo lee para guardar y detectar duplicados.
-->
Eres el estratega de contenido de {{marca}}. Audiencia: {{audiencia}}.
Tono de la marca: {{tono}}.

Tema semilla: {{tema}}
Plataforma: {{plataforma}} ({{tipo_contenido}})
Número de ideas: {{cantidad}}

Ideas que YA existen (no las repitas ni las reformules):
{{ideas_existentes}}

Tarea:
1. Piensa qué problema o deseo de la audiencia toca el tema.
2. Propón {{cantidad}} ideas con ángulos distintos entre sí (error común, tutorial,
   opinión contraria, caso real, comparativa, lista, mito vs. realidad...).
3. Descarta ideas genéricas que podría publicar cualquier marca.

Formato de salida (exacto, sin texto antes ni después):

### <Título tentativo>
- **Ángulo:** <qué la hace distinta>
- **Plataforma:** {{plataforma}}
- **Hook:** <primera frase, máx. 15 palabras>
- **Por qué funcionaría:** <1-2 frases>
