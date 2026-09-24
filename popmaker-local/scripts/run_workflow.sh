#!/usr/bin/env bash
# Ejecuta el pipeline completo sin abrir la interfaz de Claude Code (modo headless).
#
# Uso:
#   ./scripts/run_workflow.sh "tema semilla" [-n 5] [-p instagram] [-g 1] [--sin-imagenes] [--modo mcp|script]
#
# Ejemplos:
#   ./scripts/run_workflow.sh "productividad para freelancers"
#   ./scripts/run_workflow.sh "recetas de batch cooking" -n 8 -p tiktok -g 2 --modo script

set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"

uso() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

TEMA="" ; N="" ; GUIONES="" ; SIN_IMAGENES=0 ; MODO="${POPMAKER_IMAGE_MODE:-mcp}"
PLATAFORMAS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -n|--n)           N="$2"; shift 2 ;;
    -p|--plataforma)  PLATAFORMAS+=("$2"); shift 2 ;;
    -g|--guiones)     GUIONES="$2"; shift 2 ;;
    --sin-imagenes)   SIN_IMAGENES=1; shift ;;
    --modo)           MODO="$2"; shift 2 ;;
    -h|--help)        uso ;;
    -*)               echo "Opción desconocida: $1" >&2; uso 1 ;;
    *)                TEMA="${TEMA:+$TEMA }$1"; shift ;;
  esac
done
[ -n "$TEMA" ] || { echo "Falta el tema semilla." >&2; uso 1; }
case "$MODO" in mcp|script|off) ;; *) echo "--modo debe ser mcp, script u off" >&2; exit 1 ;; esac

command -v claude >/dev/null 2>&1 || { echo "No se encuentra 'claude'. Instala Claude Code: npm install -g @anthropic-ai/claude-code" >&2; exit 1; }

# Carga .env para que el servidor MCP y los scripts reciban las claves.
if [ -f .env ]; then
  set -a; . ./.env; set +a
fi
if [ "$SIN_IMAGENES" = 1 ]; then MODO=off; fi
if [ "$MODO" != off ] && [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "Aviso: GEMINI_API_KEY no está definida; las imágenes fallarán. Añádela a .env o usa --sin-imagenes." >&2
fi
export POPMAKER_IMAGE_MODE="$MODO"

ARGS="$TEMA"
[ -n "$N" ] && ARGS+=" --n $N"
for p in "${PLATAFORMAS[@]+"${PLATAFORMAS[@]}"}"; do ARGS+=" --plataforma $p"; done
[ -n "$GUIONES" ] && ARGS+=" --guiones $GUIONES"
[ "$SIN_IMAGENES" = 1 ] && ARGS+=" --sin-imagenes"

mkdir -p data/logs
LOG="data/logs/$(date +%Y-%m-%d_%H%M%S).log"
echo "▶ /generar-contenido $ARGS  (imágenes: $MODO)"
echo "  Registro: $LOG"

# Los permisos vienen de .claude/settings.json; acceptEdits evita confirmar cada escritura.
claude -p "/generar-contenido $ARGS" --permission-mode acceptEdits 2>&1 | tee "$LOG"
