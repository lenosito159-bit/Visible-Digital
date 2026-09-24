#!/usr/bin/env python3
"""Comprueba un guion contra las reglas medibles de config/brand_voice.yaml.

  python3 scripts/validar_guion.py data/output/guiones/<guion>.md

Reglas:
  - Ninguna expresión de `prohibidas`.
  - Si existe estructura.<plataforma>_<formato> (ej. instagram_carrusel):
      número de "### Slide N" dentro del rango de `slides` ("7-9") y
      palabras por slide <= el número de `longitud_por_slide` ("máximo 15 palabras").
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
    reglas = (voz.get("estructura") or {}).get(f"{plataforma}_{formato}") or {}

    if reglas:
        slides = re.findall(r"^###\s+Slide\s+\d+\s*\n(.*?)(?=^#{2,3}\s|\Z)", texto, re.MULTILINE | re.DOTALL)
        if m := re.match(r"\s*(\d+)\s*-\s*(\d+)", str(reglas.get("slides", ""))):
            minimo, maximo = int(m.group(1)), int(m.group(2))
            if not minimo <= len(slides) <= maximo:
                errores.append(f"{len(slides)} slides; deben ser {minimo}-{maximo}")
        if m := re.search(r"(\d+)", str(reglas.get("longitud_por_slide", ""))):
            limite = int(m.group(1))
            for i, slide in enumerate(slides, 1):
                n = contar_palabras(slide)
                if n > limite:
                    errores.append(f"Slide {i}: {n} palabras (máximo {limite})")

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
