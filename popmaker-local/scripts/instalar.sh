#!/usr/bin/env bash
# Puesta en marcha en un solo paso:
#   1. instala la dependencia de Python (PyYAML),
#   2. crea .env a partir de .env.example si no existe,
#   3. pide tu clave de Gemini SIN mostrarla en pantalla y la guarda en .env (permisos 600),
#   4. ejecuta el diagnóstico.
#
# Uso:  scripts/instalar.sh
#
# Decisión de diseño: la clave se escribe solo en .env (ignorado por git) y nunca se
# imprime, para no tener que pegarla en chats, terminales compartidas o capturas.

set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"

echo "== 1/4 Dependencias de Python"
python3 -m pip install --quiet -r requirements.txt

echo "== 2/4 Archivo .env"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "   Creado .env a partir de .env.example"
else
  echo "   .env ya existe: se conserva"
fi
chmod 600 .env

echo "== 3/4 Clave de Gemini"
ACTUAL="$(sed -n 's/^GEMINI_API_KEY=//p' .env | head -1)"
if [ -n "$ACTUAL" ]; then
  printf "   Ya hay una clave guardada. ¿Sustituirla? [s/N] "
  read -r RESP
else
  RESP="s"
fi
if [ "$RESP" = "s" ] || [ "$RESP" = "S" ]; then
  printf "   Pega tu clave de https://aistudio.google.com/apikey (no se verá) y pulsa Enter: "
  read -rs CLAVE; echo
  if [ -z "$CLAVE" ]; then
    echo "   No se introdujo ninguna clave; puedes añadirla luego en .env"
  else
    python3 - "$CLAVE" <<'PY'
import re, sys
from pathlib import Path
p = Path(".env"); texto = p.read_text(encoding="utf-8")
linea = f"GEMINI_API_KEY={sys.argv[1]}"
texto = re.sub(r"^GEMINI_API_KEY=.*$", lambda _: linea, texto, flags=re.M) if re.search(r"^GEMINI_API_KEY=", texto, re.M) else texto + "\n" + linea + "\n"
p.write_text(texto, encoding="utf-8")
PY
    echo "   Clave guardada en .env"
  fi
fi

echo "== 4/4 Diagnóstico"
python3 scripts/diagnostico.py || true

cat <<'TXT'

Siguientes pasos:
  set -a; source .env; set +a     # carga la clave para Claude Code y el MCP
  claude                          # acepta "trust this folder" y aprueba mcp-media-toolkit
  /generar-contenido --tema "tu tema" --plataforma instagram --cantidad 1 --dry-run
TXT
