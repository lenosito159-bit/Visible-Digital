#!/usr/bin/env bash
# Hook PostToolUse (Write|Edit): cuando se guarda un guion en data/output/*.md con
# bloques ```image-prompt```, lanza la generación de imágenes.
#
# POPMAKER_IMAGE_MODE decide cómo:
#   mcp    (defecto) devuelve a Claude los prompts completos para que llame a mcp-media-toolkit
#   script genera aquí mismo con scripts/generate_images.py (API de Gemini directa)
#   off    no hace nada
#
# Nunca bloquea a Claude: ante cualquier error sale con 0 y, si procede, lo informa.

set -uo pipefail

RAIZ="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
export POPMAKER_RAIZ="$RAIZ"
export POPMAKER_MODO="${POPMAKER_IMAGE_MODE:-mcp}"
export POPMAKER_ENTRADA="$(cat)"

[ "$POPMAKER_MODO" = "off" ] && exit 0
command -v python3 >/dev/null 2>&1 || exit 0

python3 - <<'PY'
import json
import os
import subprocess
import sys
from pathlib import Path

raiz = Path(os.environ["POPMAKER_RAIZ"]).resolve()
modo = os.environ["POPMAKER_MODO"]
try:
    entrada = json.loads(os.environ.get("POPMAKER_ENTRADA") or "{}")
except json.JSONDecodeError:
    sys.exit(0)

ruta = (entrada.get("tool_input") or {}).get("file_path") or ""
if not ruta:
    sys.exit(0)
ruta = Path(ruta)
if not ruta.is_absolute():
    ruta = Path(entrada.get("cwd") or raiz) / ruta
ruta = ruta.resolve()

# Solo guiones: data/output/<archivo>.md (no subcarpetas como imagenes/).
if ruta.suffix != ".md" or ruta.parent != raiz / "data" / "output" or not ruta.is_file():
    sys.exit(0)

script = raiz / "scripts" / "generate_images.py"


def responder(texto: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": texto}
    }, ensure_ascii=False))


try:
    info = json.loads(subprocess.run(
        [sys.executable, str(script), "prompts", str(ruta)],
        capture_output=True, text=True, check=True, cwd=raiz,
    ).stdout)
except (subprocess.CalledProcessError, json.JSONDecodeError) as e:
    responder(f"[popmaker] No se pudieron leer los prompts de {ruta.name}: {e}")
    sys.exit(0)

if info["omitir"] or not info["prompts"]:
    sys.exit(0)

aviso = ""
if info["prompt_base_con_placeholders"]:
    aviso = ("\nAviso: el prompt base de .claude/skills/estilo-visual/SKILL.md aún tiene "
             "placeholders sin rellenar ([COLOR_PRIMARIO]...). Díselo al usuario en el resumen.")

if modo == "script":
    proceso = subprocess.run(
        [sys.executable, str(script), "generar", str(ruta)],
        capture_output=True, text=True, cwd=raiz,
    )
    salida = (proceso.stdout + proceso.stderr).strip()
    responder(f"[popmaker] Resultado de generar las imágenes de {ruta.name} con scripts/generate_images.py "
              f"(código {proceso.returncode}):\n{salida}{aviso}")
    sys.exit(0)

if info["s3"]:
    herramienta = "mcp__mcp-media-toolkit__generate_and_upload_gemini_s3"
    extra = lambda p: f', key="{info["s3_prefijo"]}/{p["archivo"]}.png"'
else:
    herramienta = "mcp__mcp-media-toolkit__generate_image_gemini"
    extra = lambda p: ""

lineas = [
    f"[popmaker] El guion {ruta.relative_to(raiz)} tiene {len(info['prompts'])} prompt(s) de imagen.",
    f"Genera cada imagen llamando a {herramienta} con estos parámetros exactos "
    "(el prompt ya incluye el prompt base de estilo-visual; no lo modifiques):",
    "",
]
for p in info["prompts"]:
    lineas.append(
        f'{p["n"]}. prompt="{p["prompt"]}", aspect_ratio="{info["aspect_ratio"]}", '
        f'quality="{info["calidad"]}", output_dir="{info["output_dir"]}"{extra(p)}'
    )
lineas += [
    "",
    f"Después añade al final del guion (con Edit) una sección '## Imágenes generadas' con la línea "
    f"'<!-- imagenes-generadas -->' y una línea por imagen: ruta local"
    + (" y URL pública" if info["s3"] else "") + ", o el error si falló. "
    "Esa marca evita que este hook vuelva a pedir las imágenes.",
    "Si la herramienta MCP no está disponible, ejecuta en su lugar: "
    f"python3 scripts/generate_images.py generar {ruta.relative_to(raiz)}",
]
responder("\n".join(lineas) + aviso)
PY
exit 0
