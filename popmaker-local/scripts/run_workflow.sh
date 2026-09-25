#!/usr/bin/env bash
# Ejecución desatendida del pipeline (cron, launchd o a mano).
#
# Uso:
#   scripts/run_workflow.sh --tema "<tema>" [--plataforma linkedin] [--cantidad 1]
#                           [--solo-texto] [--solo-imagen] [--sin-claude] [--dry-run]
#
# Modos:
#   (defecto)      Claude Code en modo headless ejecuta /generar-contenido: ideas, guiones
#                  e imágenes (estas vía hook). Después se generan las imágenes que falten.
#   --solo-texto   Igual, pero sin imágenes.
#   --solo-imagen  Solo genera las imágenes de los guiones que no tienen .txt.
#   --sin-claude   Solo ideas con Gemini (generate_ideas.py) + imágenes pendientes.
#                  Los guiones necesitan a Claude.
#   --dry-run      Muestra qué haría en cada paso, sin generar nada.
#
# Ejemplo de cron (lunes a viernes a las 8:00):
#   0 8 * * 1-5 /ruta/a/popmaker-local/scripts/run_workflow.sh --tema "productividad" >> /tmp/popmaker.log 2>&1
#
# Decisión de diseño: el script es un encadenador simple. La lógica vive en el comando
# /generar-contenido y en los scripts Python, que también se pueden usar por separado.

set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"
# cron arranca con un PATH mínimo: añadimos las rutas habituales de node, npx y claude.
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

uso() { sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

TEMA="" ; PLATAFORMA="linkedin" ; CANTIDAD=1
SOLO_TEXTO=0 ; SOLO_IMAGEN=0 ; SIN_CLAUDE=0 ; DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tema)        TEMA="$2"; shift 2 ;;
    --plataforma)  PLATAFORMA="$2"; shift 2 ;;
    --cantidad)    CANTIDAD="$2"; shift 2 ;;
    --solo-texto)  SOLO_TEXTO=1; shift ;;
    --solo-imagen) SOLO_IMAGEN=1; shift ;;
    --sin-claude)  SIN_CLAUDE=1; shift ;;
    --dry-run)     DRY_RUN=1; shift ;;
    -h|--help)     uso ;;
    *) echo "Opción desconocida: $1" >&2; uso 1 ;;
  esac
done

# Validar antes de crear el registro.
[ "$SOLO_IMAGEN" = 1 ] || [ -n "$TEMA" ] || { echo "Falta --tema" >&2; uso 1; }

# Claves para los scripts y para el servidor MCP que lanza Claude Code.
if [ -f .env ]; then set -a; . ./.env; set +a; fi

LOG_DIR="data/logs"; mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(date +%Y-%m-%d_%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1
echo "== popmaker $(date '+%F %T') · registro: $LOG"

DRY=() ; [ "$DRY_RUN" = 1 ] && DRY=(--dry-run)

imagenes_pendientes() {
  echo "-- Imágenes pendientes"
  python3 scripts/generate_images.py --pendientes "${DRY[@]+"${DRY[@]}"}"
}

if [ "$SOLO_IMAGEN" = 1 ]; then
  imagenes_pendientes
  exit $?
fi

if [ "$SIN_CLAUDE" = 1 ]; then
  echo "-- Ideas con Gemini (sin Claude)"
  python3 scripts/generate_ideas.py generar --tema "$TEMA" --plataforma "$PLATAFORMA" \
    --cantidad "$CANTIDAD" "${DRY[@]+"${DRY[@]}"}"
  [ "$SOLO_TEXTO" = 1 ] || imagenes_pendientes
  exit 0
fi

command -v claude >/dev/null 2>&1 || {
  echo "No se encuentra 'claude'. Instálalo (npm install -g @anthropic-ai/claude-code) o usa --sin-claude." >&2
  exit 1
}

ARGS="--tema \"$TEMA\" --plataforma $PLATAFORMA --cantidad $CANTIDAD"
[ "$SOLO_TEXTO" = 1 ] && ARGS+=" --solo-texto"
[ "$DRY_RUN" = 1 ] && ARGS+=" --dry-run"
# El hook respeta estas variables: sin imágenes o solo simulación.
[ "$SOLO_TEXTO" = 1 ] && export POPMAKER_IMAGENES=off
[ "$DRY_RUN" = 1 ] && export POPMAKER_DRY_RUN=1

echo "-- claude -p \"/generar-contenido $ARGS\""
# acceptEdits: escribe archivos sin pedir confirmación. El resto de permisos (scripts y
# herramientas MCP) están en .claude/settings.json.
claude -p "/generar-contenido $ARGS" --permission-mode acceptEdits

# Red de seguridad: imágenes que el hook no llegó a generar.
[ "$SOLO_TEXTO" = 1 ] || imagenes_pendientes
