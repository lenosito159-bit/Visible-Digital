<!--
Cómo se construye el prompt final de imagen (lo hace scripts/generate_images.py):

    prompt final = <descripción de "## Imagen sugerida"> + " " + <Prompt base de estilo-visual>

Este archivo es la guía para escribir la descripción (la primera parte).
-->
# Cómo escribir la "Imagen sugerida"

Escribe en inglés (los modelos de imagen siguen mejor las instrucciones en inglés),
en 2-4 frases:

1. **Sujeto** concreto y qué hace.
2. **Escena**: lugar y objetos clave.
3. **Composición**: encuadre y dónde queda espacio libre para el título.
4. **Emoción** que debe transmitir, ligada al hook.

Reglas:

- Concreto antes que abstracto: "a cluttered desk with three open laptops", no "chaos".
- Sin texto dentro de la imagen, sin logos, sin personas reales reconocibles.
- No incluyas colores ni estilo: eso lo pone el prompt base de la skill `estilo-visual`.

Ejemplo:

> A freelance designer on a sofa, looking relieved at a laptop showing a simple weekly
> calendar. Warm living room with plants and a coffee mug. Medium shot, subject on the
> right third, empty wall on the left for a headline. Feeling of calm control after chaos.
