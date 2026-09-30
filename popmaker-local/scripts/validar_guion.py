#!/usr/bin/env python3
"""Comprueba un guion contra las reglas medibles de config/brand_voice.yaml.

  python3 scripts/validar_guion.py data/output/guiones/<guion>.md

Reglas:
  - Ninguna expresión de `prohibidas`.
  - Reglas de estructura.<plataforma>_<formato> (ej. instagram_carrusel) o, si no
    existe, de estructura.<plataforma> (ej. linkedin):
      slides / escenas     número de "### Slide N" / "### Escena N" en rango ("7-9")
      longitud_por_slide   palabras máximas por slide ("máximo 15 palabras")
      palabras             palabras de "## Desarrollo" en rango ("150-300")
  - Si el frontmatter dice `cta: oferta`, el enlace de la oferta debe aparecer.
  - Sección "## Imagen sugerida" presente (solo aviso: falta a propósito en --solo-texto).

Decisión de diseño: Claude aplica la voz, pero contar palabras no se le da bien de forma
fiable. Este script lo hace de forma determinista; el hook le pasa el resultado a Claude
para que corrija. Sale con 1 si hay errores.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import comun  # noqa: E402

EMOJI = re.compile(r"[\U0001F300-\U0001FAFF☀-➿]")


def contar_palabras(texto: str) -> int:
    texto = re.sub(r"\[[^\]]*\]", "", texto)  # marcas tipo [PLANO]
    return len([p for p in EMOJI.sub("", texto).split() if re.search(r"\w", p)])


def leer_rango(valor) -> tuple[int, int] | None:
    """'7-9' -> (7, 9). None si no hay rango."""
    m = re.match(r"\s*(\d+)\s*-\s*(\d+)", str(valor or ""))
    return (int(m.group(1)), int(m.group(2))) if m else None


def bloques(texto: str, tipo: str) -> list[str]:
    """Contenido de cada '### Slide N' o '### Escena N'."""
    return re.findall(rf"^###\s+{tipo}\s+\d+[^\n]*\n(.*?)(?=^#{{2,3}}\s|\Z)", texto, re.MULTILINE | re.DOTALL)


def validar(ruta: Path) -> tuple[list[str], list[str]]:
    texto = ruta.read_text(encoding="utf-8")
    voz = comun.cargar_yaml("brand_voice.yaml")
    errores, avisos = [], []

    minusculas = texto.lower()
    for frase in voz.get("prohibidas") or voz.get("palabras_prohibidas") or []:
        if frase.lower() in minusculas:
            errores.append(f'Expresión prohibida: "{frase}"')

    meta = dict(re.findall(r"^(\w+):\s*(.+)$", texto.split("\n---", 1)[0], re.MULTILINE))
    plataforma = meta.get("plataforma", "")
    formato = comun.plataformas().get(plataforma, {}).get("formato", "")
    estructura = voz.get("estructura") or {}
    reglas = estructura.get(f"{plataforma}_{formato}") or estructura.get(plataforma) or {}

    if reglas:
        slides = bloques(texto, "Slide")
        for nombre, encontrados in (("slides", slides), ("escenas", bloques(texto, "Escena"))):
            if rango := leer_rango(reglas.get(nombre)):
                if not rango[0] <= len(encontrados) <= rango[1]:
                    errores.append(f"{len(encontrados)} {nombre}; deben ser {rango[0]}-{rango[1]}")
        if rango := leer_rango(reglas.get("palabras")):
            desarrollo = re.search(r"^##\s+Desarrollo\s*$(.*?)(?=^##\s|\Z)", texto, re.MULTILINE | re.DOTALL)
            n = contar_palabras(re.sub(r"^###.*$", "", desarrollo.group(1), flags=re.MULTILINE)) if desarrollo else 0
            if not rango[0] <= n <= rango[1]:
                errores.append(f"Desarrollo: {n} palabras; deben ser {rango[0]}-{rango[1]}")
        if m := re.search(r"(\d+)", str(reglas.get("longitud_por_slide", ""))):
            limite = int(m.group(1))
            for i, slide in enumerate(slides, 1):
                n = contar_palabras(slide)
                if n > limite:
                    errores.append(f"Slide {i}: {n} palabras (máximo {limite})")

    oferta = voz.get("oferta") or {}
    if meta.get("cta") == "oferta":
        enlace = str(oferta.get("enlace") or "").strip()
        if not oferta.get("activa") or not enlace:
            errores.append("cta: oferta, pero la oferta no está activa o no tiene enlace en brand_voice.yaml")
        elif enlace.lower() not in minusculas:
            errores.append(f'CTA de oferta sin el enlace "{enlace}"')

    if not re.search(r"^##\s+Imagen sugerida", texto, re.MULTILINE):
        avisos.append("No hay sección '## Imagen sugerida' (correcto solo en modo --solo-texto)")
    return errores, avisos


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    ruta = Path(sys.argv[1])
    errores, avisos = validar(ruta)
    for aviso in avisos:
        print(f"   Aviso: {aviso}")
    if errores:
        print(f"   Estilo: {len(errores)} problema(s) en {ruta.name}:")
        for error in errores:
            print(f"   - {error}")
        return 1
    print(f"   Estilo: OK ({ruta.name})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
