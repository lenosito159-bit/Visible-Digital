#!/usr/bin/env bash
# Hook PostToolUse (matcher: Write|Edit), configurado en .claude/settings.json.
#
# Cuando Claude escribe o edita un guion en data/output/guiones/*.md:
#   1. Valida el guion contra las reglas medibles de brand_voice.yaml
#      (scripts/validar_guion.py): slides, palabras por slide, expresiones prohibidas.
#   2. Si tiene "## Imagen sugerida" y aún no tiene .txt, genera la imagen llamando al
#      MCP (mcp-media-toolkit) y guarda la URL en un .txt junto al guion
#      (scripts/generate_images.py).
#
# Decisiones de diseño:
# - El hook llama al MCP por stdio a través del script, no le pide a Claude que lo haga:
#   así la imagen se genera aunque Claude se olvide, y el mismo código sirve para cron.
# - Escucha también Edit: en las pruebas, Claude a veces añadía "## Imagen sugerida" con
#   Edit después del Write, y con solo Write la imagen no se generaba.
# - Nunca bloquea a Claude (siempre sale con 0). El resultado se le pasa como
#   "additionalContext" para que corrija el estilo y lo incluya en su resumen.
# - Variables para controlarlo:
#     POPMAKER_IMAGENES=off  desactiva la generación de imágenes (modo "solo texto")
#     POPMAKER_DRY_RUN=1     muestra qué haría sin generar nada

set -uo pipefail

RAIZ="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

# Ruta del archivo escrito (el JSON del evento llega por stdin).
ARCHIVO="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)"

# Solo guiones de data/output/guiones/.
case "$ARCHIVO" in
  "$RAIZ"/data/output/guiones/*.md) ;;
  *) exit 0 ;;
esac
[ -f "$ARCHIVO" ] || exit 0
cd "$RAIZ" || exit 0

# 1. Validación de estilo (siempre).
SALIDA="$(python3 scripts/validar_guion.py "$ARCHIVO" 2>&1)"
CODIGO=$?
[ $CODIGO -ne 0 ] && SALIDA="$SALIDA
   Corrige estos problemas con Edit antes del resumen."

# 2. Imagen: solo si hay sección, no existe ya el .txt y no está desactivada.
if [ "${POPMAKER_IMAGENES:-on}" != "off" ] \
   && grep -qE '^##[[:space:]]+Imagen sugerida' "$ARCHIVO" \
   && [ ! -f "${ARCHIVO%.md}.txt" ]; then
  OPCIONES=()
  [ "${POPMAKER_DRY_RUN:-0}" = "1" ] && OPCIONES+=(--dry-run)
  IMAGEN="$(python3 scripts/generate_images.py "$ARCHIVO" "${OPCIONES[@]+"${OPCIONES[@]}"}" 2>&1)"
  [ $? -ne 0 ] && CODIGO=1
  SALIDA="$SALIDA
$IMAGEN"
fi

# Devuelve el resultado a Claude como contexto adicional.
SALIDA="$SALIDA" CODIGO="$CODIGO" python3 -c '
import json, os
estado = "OK" if os.environ["CODIGO"] == "0" else "REVISAR"
print(json.dumps({"hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": f"[hook popmaker {estado}]\n" + os.environ["SALIDA"],
}}, ensure_ascii=False))
'
exit 0
