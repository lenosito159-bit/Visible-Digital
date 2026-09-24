---
name: estilo-visual
description: Define el estilo visual de la marca para generación de imágenes. Usar SIEMPRE que se genere cualquier imagen de contenido, referencia o carrusel.
---

# Estilo Visual

## Paleta de colores
- Primario: #1F2A44 — azul noche
- Secundario: #F4A261 — naranja cálido
- Acento: #2A9D8F — verde azulado
- Fondo: #FAF7F2 — crema
- Texto: #2C2C2C — gris carbón

## Tipo de imagen
- Estilo general: ilustración flat minimalista
- Trazo: líneas finas uniformes, sin contornos gruesos
- Iluminación: plana, sin degradados complejos
- Composición: mucho espacio negativo, un objeto central por slide

## Referencias de estilo
- Estética similar a: Notion, Linear, Substack, Gumroad
- Tono visual: limpio, humano, sin pretensiones corporativas

## Elementos a EVITAR
- 3D realista, texturas metálicas
- Sombras duras o degradados complejos
- Stock photos genéricas
- Texto dentro de la imagen generada (el texto va superpuesto después)
- Personas con caras detalladas (usar siluetas o figuras estilizadas)

## Formato Instagram carrusel
- Dimensiones: 1080x1350 (aspect ratio 3:4)
- Margen seguro: 80px en los bordes
- Reservar tercio inferior para texto superpuesto
- Una sola idea visual por slide

## Prompt base (se añade SIEMPRE al final)
<!-- scripts/generate_images.py lee el texto entre estos dos comentarios y lo añade a
la "Imagen sugerida" de cada guion. Edita el texto, pero no borres los comentarios.
No pongas aquí el formato (3:4, 16:9...): el script añade el de cada plataforma
según config/plataformas.yaml. -->
<!-- prompt-base:inicio -->
"minimalist flat illustration, Notion and Linear inspired aesthetic, 
color palette: deep night blue #1F2A44, warm orange #F4A261, teal #2A9D8F, 
cream background #FAF7F2, thin uniform lines, flat lighting, 
generous negative space, single central object, no text, no watermarks, 
no detailed human faces, high quality"
<!-- prompt-base:fin -->
