#!/usr/bin/env bash
# Hook PostToolUse (matcher: Write), configurado en .claude/settings.json.
#
# Cuando Claude escribe un guion en data/output/guiones/*.md que tiene una sección
# "## Imagen sugerida", genera la imagen llamando al MCP (mcp-media-toolkit) y guarda
# la URL en un .txt junto al guion. Todo el trabajo lo hace scripts/generate_images.py;
# este hook solo decide si toca ejecutarlo.
#
# Decisiones de diseño:
# - El hook llama al MCP por stdio a través del script, no le pide a Claude que lo haga:
#   así la imagen se genera aunque Claude se olvide, y el mismo código sirve para cron.
# - Nunca bloquea a Claude (siempre sale con 0). El resultado se le pasa como
#   "additionalContext" para que lo incluya en su resumen.
# - Variables para controlarlo:
#     POPMAKER_IMAGENES=off  desactiva la generación (modo "solo texto")
#     POPMAKER_DRY_RUN=1     muestra qué haría sin generar nada

set -uo pipefail

RAIZ="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
[ "${POPMAKER_IMAGENES:-on}" = "off" ] && exit 0

# Ruta del archivo escrito (el JSON del evento llega por stdin).
ARCHIVO="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)"

# Solo guiones de data/output/guiones/ con sección "## Imagen sugerida".
case "$ARCHIVO" in
  "$RAIZ"/data/output/guiones/*.md) ;;
  *) exit 0 ;;
esac
grep -qE '^##[[:space:]]+Imagen sugerida' "$ARCHIVO" 2>/dev/null || exit 0
# Ya tiene imagen (.txt con la URL): no regenerar. Para forzar, borra el .txt.
[ -f "${ARCHIVO%.md}.txt" ] && exit 0

OPCIONES=()
[ "${POPMAKER_DRY_RUN:-0}" = "1" ] && OPCIONES+=(--dry-run)

SALIDA="$(cd "$RAIZ" && python3 scripts/generate_images.py "$ARCHIVO" "${OPCIONES[@]+"${OPCIONES[@]}"}" 2>&1)"
CODIGO=$?

# Devuelve el resultado a Claude como contexto adicional.
SALIDA="$SALIDA" CODIGO="$CODIGO" python3 -c '
import json, os
estado = "OK" if os.environ["CODIGO"] == "0" else "ERROR"
print(json.dumps({"hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": f"[hook imagen {estado}]\n" + os.environ["SALIDA"],
}}, ensure_ascii=False))
'
exit 0
