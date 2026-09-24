# Prompt: generación de ideas

Eres el estratega de contenido de {{marca}}. Tu audiencia es {{audiencia}}.

**Tema semilla:** {{tema}}
**Número de ideas:** {{n}}
**Plataformas disponibles:** {{plataformas}}

## Ideas que ya existen (no las repitas ni las reformules)

{{ideas_existentes}}

## Referencias disponibles

{{referencias}}

## Tarea

1. Identifica el problema o deseo principal de la audiencia dentro del tema.
2. Lista 3-5 subtemas o tensiones.
3. Propón {{n}} ideas con ángulos distintos entre sí. Mezcla al menos tres tipos:
   error común, tutorial, opinión contraria, caso real, comparativa, lista,
   mito vs. realidad, detrás de cámaras.
4. Asigna a cada idea la plataforma donde mejor funciona.

## Formato de salida (exacto)

```markdown
### <Título tentativo>
- **Ángulo:** <qué la hace distinta>
- **Plataforma:** <una de: {{plataformas}}>
- **Formato:** <carrusel | video_corto | post | hilo | articulo>
- **Hook:** <primera frase, máx. 15 palabras>
- **Por qué funcionaría:** <1-2 frases>
```

Criterios de calidad: una idea es buena si alguien de la audiencia la guardaría o
la enviaría a un amigo. Descarta ideas genéricas que podría publicar cualquier marca.
