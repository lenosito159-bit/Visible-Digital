#!/usr/bin/env python3
"""Comprueba que todo está listo para generar contenido y dice qué falta.

  python3 scripts/diagnostico.py            # comprobaciones gratuitas
  python3 scripts/diagnostico.py --imagen   # además genera 1 imagen de prueba (coste: céntimos)

Decisiones de diseño:
- Por defecto no gasta nada: valida la clave listando modelos y hace una llamada de texto,
  que es gratuita. La prueba de imagen es opcional porque con facturación activa cuesta.
- Cada comprobación dice qué hacer si falla, no solo que falló.
- Nunca muestra la clave completa.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

OK, FALLO, AVISO = "✔", "✘", "!"
resultados: list[tuple[str, str, str]] = []


def anotar(estado: str, que: str, detalle: str = "") -> None:
    resultados.append((estado, que, detalle))
    print(f"  {estado} {que}" + (f"\n      {detalle}" if detalle else ""))


def listar_modelos(clave: str) -> tuple[int, dict]:
    peticion = urllib.request.Request(
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
        headers={"x-goog-api-key": clave})
    try:
        with urllib.request.urlopen(peticion, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, {}
    except urllib.error.URLError as e:
        return 0, {"error": str(e.reason)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--imagen", action="store_true", help="Genera 1 imagen de prueba (tiene coste)")
    args = parser.parse_args()

    print("\n== Programas")
    anotar(OK if sys.version_info >= (3, 9) else FALLO, f"Python {sys.version.split()[0]}",
           "" if sys.version_info >= (3, 9) else "Instala Python 3.9 o superior.")
    try:
        import yaml  # noqa: F401
        anotar(OK, "PyYAML instalado")
    except ImportError:
        anotar(FALLO, "Falta PyYAML", "Ejecuta: pip install -r requirements.txt")
        return 1
    import comun
    for programa, para, ayuda in (
        ("npx", "el servidor MCP de imágenes", "Instala Node.js 18+: https://nodejs.org"),
        ("claude", "/generar-contenido", "npm install -g @anthropic-ai/claude-code"),
    ):
        anotar(OK if shutil.which(programa) else FALLO, f"{programa} (para {para})",
               "" if shutil.which(programa) else ayuda)

    print("\n== Configuración")
    env = comun.RAIZ / ".env"
    anotar(OK if env.is_file() else FALLO, ".env",
           "" if env.is_file() else "Ejecuta scripts/instalar.sh o copia .env.example a .env")
    comun.cargar_env()
    clave = os.environ.get("GEMINI_API_KEY", "")
    if not clave:
        anotar(FALLO, "GEMINI_API_KEY", "Añádela a .env (scripts/instalar.sh te la pide sin mostrarla).")
    else:
        anotar(OK, f"GEMINI_API_KEY definida ({clave[:4]}…{clave[-4:]})")
    s3 = [v for v in ("S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET", "S3_PUBLIC_URL") if os.environ.get(v)]
    if not s3:
        anotar(OK, "S3 sin configurar: las imágenes se guardan en local (correcto)")
    elif len(s3) == 5:
        anotar(OK, "S3 configurado: las imágenes tendrán URL pública")
    else:
        anotar(FALLO, "S3 a medias", "Rellena las 5 variables S3_* o vacíalas todas; si no, el MCP no arranca.")
    oferta = comun.cargar_yaml("brand_voice.yaml").get("oferta") or {}
    if oferta.get("activa") and oferta.get("nombre") and oferta.get("enlace"):
        anotar(OK, f"Oferta activa: {oferta['nombre']} (1 de cada {oferta.get('frecuencia', 3)} piezas)")
    else:
        anotar(AVISO, "Oferta sin activar", "Para monetizar: config/brand_voice.yaml → oferta (nombre, enlace, activa: true).")
    base = comun.prompt_base()
    anotar(OK if base and not comun.tiene_placeholders(base) else FALLO, "Prompt base de estilo visual",
           "" if base and not comun.tiene_placeholders(base) else "Rellena el prompt base en .claude/skills/estilo-visual/SKILL.md")

    if clave:
        print("\n== Google Gemini")
        codigo, datos = listar_modelos(clave)
        if codigo != 200:
            anotar(FALLO, f"Clave rechazada ({codigo or datos.get('error')})",
                   "Revisa la clave en https://aistudio.google.com/apikey")
        else:
            anotar(OK, "Clave válida")
            try:
                comun.texto_gemini("Responde solo: OK")
                anotar(OK, f"Modelo de texto ({comun.MODELO_TEXTO})")
            except RuntimeError as e:
                anotar(FALLO, f"Modelo de texto ({comun.MODELO_TEXTO})", str(e)[:200])
            if args.imagen:
                try:
                    comun.gemini("gemini-2.5-flash-image", {
                        "contents": [{"parts": [{"text": "a single small orange circle on a cream background"}]}],
                        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"], "imageConfig": {"aspectRatio": "1:1"}},
                    })
                    anotar(OK, "Generación de imágenes (facturación activa)")
                except RuntimeError as e:
                    anotar(FALLO, "Generación de imágenes", str(e)[:260])
            else:
                anotar(AVISO, "Imágenes sin probar", "Ejecuta con --imagen para generar 1 imagen de prueba (céntimos).")

    print("\n== Tests automáticos")
    tests = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests"],
                           cwd=comun.RAIZ, capture_output=True, text=True)
    ultima = (tests.stderr.strip().splitlines() or ["?"])[-1]
    anotar(OK if tests.returncode == 0 else FALLO, f"Tests: {ultima}",
           "" if tests.returncode == 0 else "Ejecuta: python3 -m unittest discover -s tests -v")

    fallos = [r for r in resultados if r[0] == FALLO]
    print("\n" + ("Todo listo. Abre Claude Code en popmaker-local/ y ejecuta /generar-contenido."
                  if not fallos else f"Faltan {len(fallos)} cosa(s): arréglalas y vuelve a ejecutar el diagnóstico."))
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
