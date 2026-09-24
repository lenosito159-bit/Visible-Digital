#!/usr/bin/env python3
"""Genera las imágenes de un guion a partir de sus bloques ```image-prompt```.

A cada prompt le añade el "Prompt base" de .claude/skills/estilo-visual/SKILL.md.
Solo usa la biblioteca estándar; boto3 es opcional (para subir a S3/R2/MinIO).

Uso:
    python3 scripts/generate_images.py prompts data/output/2026-09-24_mi-guion.md
    python3 scripts/generate_images.py generar data/output/2026-09-24_mi-guion.md [--dry-run]
    python3 scripts/generate_images.py generar --todos          # todos los guiones pendientes

Variables de entorno (se leen también de .env): GEMINI_API_KEY y, para subir,
S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_PUBLIC_URL, S3_REGION.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DIR_OUTPUT = RAIZ / "data" / "output"
DIR_IMAGENES = DIR_OUTPUT / "imagenes"
SKILL_ESTILO = RAIZ / ".claude" / "skills" / "estilo-visual" / "SKILL.md"
BRAND_VOICE = RAIZ / "config" / "brand_voice.yaml"

MARCA_HECHO = "<!-- imagenes-generadas -->"
BLOQUE_PROMPT = re.compile(r"```image-prompt[ \t]*\n(.*?)\n```", re.DOTALL)
PROMPT_BASE = re.compile(
    r"^<!--\s*prompt-base:inicio\s*-->\s*$(.*?)^<!--\s*prompt-base:fin\s*-->\s*$", re.DOTALL | re.MULTILINE
)
ASPECT_RATIOS = {"1:1", "16:9", "9:16", "4:3", "3:4"}
# Mismos modelos que usan los presets de mcp-media-toolkit.
MODELOS = {
    "fast": ("gemini-2.5-flash-image", None),
    "balanced": ("gemini-3.1-flash-image-preview", "2K"),
    "quality": ("gemini-3-pro-image-preview", "4K"),
}
EXTENSIONES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
S3_OBLIGATORIAS = ("S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET", "S3_PUBLIC_URL")


def cargar_env() -> None:
    """Carga .env sin pisar variables ya definidas en el entorno."""
    ruta = RAIZ / ".env"
    if not ruta.is_file():
        return
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, valor = linea.split("=", 1)
        valor = valor.strip().strip('"').strip("'")
        if valor:
            os.environ.setdefault(clave.strip().removeprefix("export ").strip(), valor)


def leer_frontmatter(texto: str) -> dict[str, str]:
    m = re.match(r"^---\n(.*?)\n---", texto, re.DOTALL)
    if not m:
        return {}
    datos = {}
    for linea in m.group(1).splitlines():
        if ":" in linea:
            clave, valor = linea.split(":", 1)
            datos[clave.strip()] = valor.strip().strip('"').strip("'")
    return datos


def prompt_base() -> str:
    if not SKILL_ESTILO.is_file():
        return ""
    m = PROMPT_BASE.search(SKILL_ESTILO.read_text(encoding="utf-8"))
    return " ".join(m.group(1).split()) if m else ""


def calidad_por_defecto() -> str:
    if BRAND_VOICE.is_file():
        m = re.search(r"^\s*calidad_imagen:\s*(\w+)", BRAND_VOICE.read_text(encoding="utf-8"), re.MULTILINE)
        if m and m.group(1) in MODELOS:
            return m.group(1)
    return "fast"


def s3_configurado() -> bool:
    return all(os.environ.get(v) for v in S3_OBLIGATORIAS)


def analizar_guion(ruta: Path, calidad: str | None = None) -> dict:
    """Todo lo necesario para generar las imágenes de un guion."""
    texto = ruta.read_text(encoding="utf-8")
    meta = leer_frontmatter(texto)
    base = prompt_base()
    aspect = meta.get("aspect_ratio", "1:1")
    if aspect not in ASPECT_RATIOS:
        aspect = "1:1"
    slug = ruta.stem
    omitir = None
    if MARCA_HECHO in texto:
        omitir = "ya tiene imágenes generadas"
    elif meta.get("imagenes", "").lower() in {"no", "false", "0"}:
        omitir = "el guion tiene 'imagenes: no'"

    prompts = []
    for i, bloque in enumerate(BLOQUE_PROMPT.findall(texto), start=1):
        escena = " ".join(bloque.split())
        if escena and not escena.startswith("<"):
            completo = f"{escena} {base}".strip()
            prompts.append({"n": i, "escena": escena, "prompt": completo, "archivo": f"{i:02d}"})

    return {
        "guion": str(ruta.resolve()),
        "slug": slug,
        "aspect_ratio": aspect,
        "calidad": calidad or calidad_por_defecto(),
        "output_dir": str((DIR_IMAGENES / slug).resolve()),
        "s3": s3_configurado(),
        "s3_prefijo": f"popmaker/{slug}",
        "prompt_base_con_placeholders": bool(re.search(r"\[[A-Z_]+\]", base)),
        "omitir": omitir,
        "prompts": prompts,
    }


def llamar_gemini(prompt: str, aspect: str, calidad: str, api_key: str) -> tuple[bytes, str]:
    modelo, tamano = MODELOS[calidad]
    image_config = {"aspectRatio": aspect}
    if tamano:
        image_config["imageSize"] = tamano
    cuerpo = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"], "imageConfig": image_config},
    }
    peticion = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent",
        data=json.dumps(cuerpo).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(peticion, timeout=240) as resp:
            datos = json.load(resp)
    except urllib.error.HTTPError as e:
        detalle = e.read().decode(errors="replace")[:500]
        raise RuntimeError(f"Gemini respondió {e.code}: {detalle}") from e

    for candidato in datos.get("candidates", []):
        for parte in candidato.get("content", {}).get("parts", []):
            inline = parte.get("inlineData") or parte.get("inline_data")
            if inline and inline.get("data"):
                mime = inline.get("mimeType") or inline.get("mime_type") or "image/png"
                return base64.b64decode(inline["data"]), mime
    motivo = datos.get("promptFeedback", {}).get("blockReason") or datos.get("candidates", [{}])[0].get("finishReason")
    raise RuntimeError(f"Gemini no devolvió imagen (motivo: {motivo or 'desconocido'})")


def subir_s3(ruta: Path, clave: str, mime: str) -> str:
    try:
        import boto3  # type: ignore
    except ImportError as e:
        raise RuntimeError("Para subir a S3 instala boto3: pip install boto3") from e
    cliente = boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT"],
        aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("S3_REGION") or "auto",
    )
    cliente.upload_file(str(ruta), os.environ["S3_BUCKET"], clave, ExtraArgs={"ContentType": mime})
    return f"{os.environ['S3_PUBLIC_URL'].rstrip('/')}/{clave}"


def anotar_guion(ruta: Path, resultados: list[dict]) -> None:
    lineas = ["", "## Imágenes generadas", MARCA_HECHO, ""]
    for r in resultados:
        if r.get("error"):
            lineas.append(f"- {r['n']:02d}: ERROR — {r['error']}")
            continue
        relativa = os.path.relpath(r["ruta"], ruta.parent)
        lineas.append(f"- {r['n']:02d}: ![imagen {r['n']}]({relativa})" + (f" · {r['url']}" if r.get("url") else ""))
    with ruta.open("a", encoding="utf-8") as f:
        f.write("\n".join(lineas) + "\n")


def generar(ruta: Path, calidad: str | None, dry_run: bool, subir: bool) -> int:
    info = analizar_guion(ruta, calidad)
    print(f"== {ruta.relative_to(RAIZ) if ruta.is_relative_to(RAIZ) else ruta}")
    if info["omitir"]:
        print(f"   Omitido: {info['omitir']}")
        return 0
    if not info["prompts"]:
        print("   No hay bloques ```image-prompt```.")
        return 0
    if info["prompt_base_con_placeholders"]:
        print("   Aviso: el prompt base de estilo-visual aún tiene placeholders [SIN_RELLENAR].", file=sys.stderr)

    if dry_run:
        for p in info["prompts"]:
            print(f"   [{p['n']:02d}] ({info['aspect_ratio']}, {info['calidad']}) {p['prompt']}")
        return 0

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("   Falta GEMINI_API_KEY (en el entorno o en .env).", file=sys.stderr)
        return 2

    salida = Path(info["output_dir"])
    salida.mkdir(parents=True, exist_ok=True)
    resultados, errores = [], 0
    for p in info["prompts"]:
        try:
            datos, mime = llamar_gemini(p["prompt"], info["aspect_ratio"], info["calidad"], api_key)
            destino = salida / f"{p['archivo']}.{EXTENSIONES.get(mime, 'png')}"
            destino.write_bytes(datos)
            r = {"n": p["n"], "ruta": str(destino)}
            if subir and info["s3"]:
                r["url"] = subir_s3(destino, f"{info['s3_prefijo']}/{destino.name}", mime)
            print(f"   [{p['n']:02d}] OK {destino.relative_to(RAIZ)}" + (f" -> {r['url']}" if r.get("url") else ""))
        except Exception as e:  # noqa: BLE001 - se informa y se sigue con el resto
            errores += 1
            r = {"n": p["n"], "error": str(e)}
            print(f"   [{p['n']:02d}] ERROR {e}", file=sys.stderr)
        resultados.append(r)

    anotar_guion(ruta, resultados)
    return 1 if errores == len(resultados) else 0


def main() -> int:
    cargar_env()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="comando", required=True)

    p = sub.add_parser("prompts", help="Imprime en JSON los prompts completos de un guion")
    p.add_argument("guion", type=Path)
    p.add_argument("--calidad", choices=MODELOS)

    p = sub.add_parser("generar", help="Genera las imágenes llamando a la API de Gemini")
    p.add_argument("guion", type=Path, nargs="?")
    p.add_argument("--todos", action="store_true", help="Todos los guiones de data/output/ sin imágenes")
    p.add_argument("--calidad", choices=MODELOS)
    p.add_argument("--dry-run", action="store_true", help="Muestra los prompts sin llamar a la API")
    p.add_argument("--sin-subir", action="store_true", help="No subir a S3 aunque esté configurado")

    args = parser.parse_args()
    if args.comando == "prompts":
        print(json.dumps(analizar_guion(args.guion, args.calidad), ensure_ascii=False, indent=2))
        return 0

    if args.todos:
        guiones = sorted(DIR_OUTPUT.glob("*.md"))
    elif args.guion:
        guiones = [args.guion]
    else:
        parser.error("indica un guion o usa --todos")
    codigo = 0
    for guion in guiones:
        codigo = max(codigo, generar(guion.resolve(), args.calidad, args.dry_run, not args.sin_subir))
    return codigo


if __name__ == "__main__":
    sys.exit(main())
