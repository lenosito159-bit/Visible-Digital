"""Utilidades compartidas por los scripts de popmaker-local.

Decisiones de diseño:
- Solo dependemos de PyYAML (para leer config/*.yaml). Las llamadas HTTP a Gemini
  usan urllib de la biblioteca estándar: menos dependencias que instalar y mantener.
- Las rutas se calculan desde la raíz del proyecto, no desde el directorio actual,
  para que los scripts funcionen igual desde cron, desde el hook o a mano.
- Las claves se leen del entorno y, si faltan, de .env. Nunca se escriben en disco.
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

try:
    import yaml
except ImportError:  # Mensaje claro en vez de un traceback.
    raise SystemExit("Falta PyYAML. Instálalo con: pip install -r requirements.txt")

RAIZ = Path(__file__).resolve().parent.parent
DIR_CONFIG = RAIZ / "config"
DIR_IDEAS = RAIZ / "data" / "ideas"
DIR_REFERENCIAS = RAIZ / "data" / "referencias"
DIR_GUIONES = RAIZ / "data" / "output" / "guiones"
DIR_IMAGENES = RAIZ / "data" / "output" / "imagenes"
SKILL_ESTILO = RAIZ / ".claude" / "skills" / "estilo-visual" / "SKILL.md"

# Modelo de texto para generate_ideas.py sin Claude. Flash: barato y suficiente para ideas.
MODELO_TEXTO = os.environ.get("GEMINI_TEXT_MODEL", "gemini-2.5-flash")
URL_GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent"


def cargar_env() -> None:
    """Carga .env sin pisar variables que ya estén definidas en el entorno."""
    ruta = RAIZ / ".env"
    if not ruta.is_file():
        return
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, valor = linea.split("=", 1)
        clave = clave.removeprefix("export ").strip()
        valor = valor.strip().strip('"').strip("'")
        if valor:
            os.environ.setdefault(clave, valor)


def cargar_yaml(nombre: str) -> dict:
    return yaml.safe_load((DIR_CONFIG / nombre).read_text(encoding="utf-8")) or {}


def plataformas() -> dict:
    return cargar_yaml("plataformas.yaml")


def plataforma(nombre: str) -> dict:
    todas = plataformas()
    if nombre not in todas:
        raise SystemExit(f"Plataforma desconocida: {nombre}. Opciones: {', '.join(todas)}")
    return todas[nombre]


def slugify(texto: str, max_len: int = 50) -> str:
    """'¿Cómo cobrar más?' -> 'como-cobrar-mas'. Nombres de archivo descriptivos y seguros."""
    texto = unicodedata.normalize("NFKD", texto.lower())
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    texto = re.sub(r"[^a-z0-9]+", "-", texto).strip("-")
    return texto[:max_len].rstrip("-") or "sin-titulo"


def prompt_base() -> str:
    """Bloque 'Prompt base' de la skill estilo-visual (entre sus comentarios marcadores)."""
    if not SKILL_ESTILO.is_file():
        return ""
    m = re.search(
        r"^<!--\s*prompt-base:inicio\s*-->\s*$(.*?)^<!--\s*prompt-base:fin\s*-->\s*$",
        SKILL_ESTILO.read_text(encoding="utf-8"),
        re.DOTALL | re.MULTILINE,
    )
    return " ".join(m.group(1).split()) if m else ""


def tiene_placeholders(texto: str) -> bool:
    return bool(re.search(r"\[[A-Z_]{3,}\]", texto))


def gemini(modelo: str, cuerpo: dict, timeout: int = 240) -> dict:
    """POST a la API de Gemini. Lanza RuntimeError con un mensaje legible si falla."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("Falta GEMINI_API_KEY (defínela en .env o en el entorno)")
    peticion = urllib.request.Request(
        URL_GEMINI.format(modelo=modelo),
        data=json.dumps(cuerpo).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(peticion, timeout=timeout) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        detalle = e.read().decode(errors="replace")
        try:
            detalle = json.loads(detalle)["error"]["message"]
        except (ValueError, KeyError, TypeError):
            detalle = detalle[:300]
        raise RuntimeError(f"Gemini respondió {e.code}: {detalle}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"No se pudo conectar con Gemini: {e.reason}") from e


def texto_gemini(prompt: str) -> str:
    datos = gemini(MODELO_TEXTO, {"contents": [{"parts": [{"text": prompt}]}]}, timeout=120)
    partes = datos.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in partes)
