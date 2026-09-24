#!/usr/bin/env python3
"""Genera la imagen de un guion a partir de su sección "## Imagen sugerida".

  prompt final = <descripción de "## Imagen sugerida"> + <Prompt base de estilo-visual>

Salida, con el mismo nombre que el guion:
  data/output/imagenes/<guion>.png   la imagen
  data/output/guiones/<guion>.txt    la URL (1.ª línea) y metadatos (líneas con #)

Ejemplos:
  python3 scripts/generate_images.py data/output/guiones/2026-09-24_linkedin_mi-post.md
  python3 scripts/generate_images.py --pendientes            # guiones sin .txt
  python3 scripts/generate_images.py --pendientes --dry-run  # qué haría, sin generar
  python3 scripts/generate_images.py <guion> --via api       # sin MCP

Decisiones de diseño:
- --via auto (defecto) llama al servidor MCP de .mcp.json (mcp-media-toolkit) como
  cliente MCP por stdio, igual que haría Claude Code. Así el hook y cron usan el mismo
  MCP que Claude. Si el MCP falla (npx ausente, error de configuración...), recurre a
  la API de Gemini directamente: la imagen se genera igual, pero sin subir a S3.
- Si hay S3 configurado se usa generate_and_upload_gemini_s3 y la URL es pública;
  si no, generate_image_gemini y la "URL" es file:// de la imagen local.
- Si el .txt ya existe, el guion se salta (evita regenerar y gastar). Usa --forzar.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import selectors
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import comun  # noqa: E402

SECCION = re.compile(r"^##\s+Imagen sugerida\s*$(.*?)(?=^##\s|\Z)", re.MULTILINE | re.DOTALL)
S3_VARS = ("S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET", "S3_PUBLIC_URL")
# Mismos modelos que los presets de mcp-media-toolkit, para que ambas vías den lo mismo.
MODELOS = {"fast": "gemini-2.5-flash-image", "balanced": "gemini-3.1-flash-image-preview",
           "quality": "gemini-3-pro-image-preview"}
TIMEOUT_MCP = 240


# --------------------------------------------------------------------------- guion

def leer_guion(ruta: Path) -> dict:
    texto = ruta.read_text(encoding="utf-8")
    meta = {}
    if m := re.match(r"^---\n(.*?)\n---", texto, re.DOTALL):
        for linea in m.group(1).splitlines():
            if ":" in linea:
                k, v = linea.split(":", 1)
                meta[k.strip()] = v.strip().strip("\"'")
    seccion = SECCION.search(texto)
    descripcion = " ".join(seccion.group(1).split()) if seccion else ""
    descripcion = re.sub(r"^>\s*", "", descripcion)
    # Una descripción que es aún la instrucción de la plantilla (<...>) no cuenta.
    if descripcion.startswith("<"):
        descripcion = ""

    plataforma = meta.get("plataforma", "")
    try:
        imagen = comun.plataforma(plataforma).get("imagen", {}) if plataforma else {}
    except SystemExit:
        imagen = {}
    base = comun.prompt_base()
    return {
        "guion": ruta,
        "descripcion": descripcion,
        # El formato va al final del prompt y además como parámetro de la API.
        "prompt": f"{descripcion} {base}, {imagen.get('aspect_ratio', '1:1')} aspect ratio".strip(),
        "aspect_ratio": imagen.get("aspect_ratio", "1:1"),
        "dimensiones": imagen.get("dimensiones", "?"),
        "imagen": comun.DIR_IMAGENES / f"{ruta.stem}.png",
        "txt": ruta.with_suffix(".txt"),
        "base_sin_rellenar": comun.tiene_placeholders(base),
    }


# --------------------------------------------------------------------------- vía MCP

def comando_mcp() -> list[str]:
    """Lee el comando del servidor desde .mcp.json (única fuente de verdad)."""
    config = json.loads((comun.RAIZ / ".mcp.json").read_text(encoding="utf-8"))
    servidor = config["mcpServers"]["mcp-media-toolkit"]
    return [servidor["command"], *servidor.get("args", [])]


def llamar_mcp(herramienta: str, argumentos: dict) -> str:
    """Cliente MCP mínimo por stdio: initialize -> tools/call. Devuelve el texto del resultado."""
    comando = comando_mcp()
    if not shutil.which(comando[0]):
        raise RuntimeError(f"'{comando[0]}' no está instalado (hace falta Node.js)")
    errores = tempfile.TemporaryFile(mode="w+")
    proceso = subprocess.Popen(comando, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errores,
                               text=True, cwd=comun.RAIZ, env=os.environ.copy())
    selector = selectors.DefaultSelector()
    selector.register(proceso.stdout, selectors.EVENT_READ)
    limite = time.monotonic() + TIMEOUT_MCP

    def enviar(mensaje: dict) -> None:
        proceso.stdin.write(json.dumps(mensaje) + "\n")
        proceso.stdin.flush()

    def esperar(id_: int) -> dict:
        while time.monotonic() < limite:
            if not selector.select(timeout=1):
                if proceso.poll() is not None:
                    break
                continue
            linea = proceso.stdout.readline()
            if not linea:
                break
            try:
                mensaje = json.loads(linea)
            except json.JSONDecodeError:
                continue
            if mensaje.get("id") == id_:
                return mensaje
        errores.seek(0)
        detalle = errores.read().strip().splitlines()[-3:]
        raise RuntimeError("el servidor MCP no respondió" + (f": {' | '.join(detalle)}" if detalle else ""))

    try:
        enviar({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "popmaker-local", "version": "1.0"}}})
        esperar(1)
        enviar({"jsonrpc": "2.0", "method": "notifications/initialized"})
        enviar({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                "params": {"name": herramienta, "arguments": argumentos}})
        respuesta = esperar(2)
    finally:
        proceso.kill()
        proceso.wait()

    if "error" in respuesta:
        raise RuntimeError(respuesta["error"].get("message", str(respuesta["error"])))
    resultado = respuesta.get("result", {})
    texto = "\n".join(c.get("text", "") for c in resultado.get("content", []) if c.get("type") == "text")
    if resultado.get("isError"):
        raise RuntimeError(texto or "error sin detalle")
    return texto


def generar_via_mcp(info: dict, calidad: str) -> tuple[str, str]:
    """Devuelve (url, herramienta). Deja la imagen en info['imagen']."""
    s3 = all(os.environ.get(v) for v in S3_VARS)
    herramienta = "generate_and_upload_gemini_s3" if s3 else "generate_image_gemini"
    temporal = Path(tempfile.mkdtemp(prefix="popmaker-"))
    argumentos = {"prompt": info["prompt"], "aspect_ratio": info["aspect_ratio"],
                  "quality": calidad, "format": "png", "output_dir": str(temporal)}
    if s3:
        argumentos["key"] = f"popmaker/{info['imagen'].name}"
    texto = llamar_mcp(herramienta, argumentos)

    local = re.search(r"(?:Saved to|Local path):\s*(.+)", texto)
    if not local:
        raise RuntimeError(f"respuesta del MCP inesperada: {texto[:200]}")
    info["imagen"].parent.mkdir(parents=True, exist_ok=True)
    shutil.move(local.group(1).strip(), info["imagen"])
    shutil.rmtree(temporal, ignore_errors=True)
    publica = re.search(r"Public URL:\s*(\S+)", texto)
    return (publica.group(1) if publica else info["imagen"].resolve().as_uri()), f"mcp:{herramienta}"


# --------------------------------------------------------------------------- vía API

def generar_via_api(info: dict, calidad: str) -> tuple[str, str]:
    modelo = MODELOS[calidad]
    config_imagen = {"aspectRatio": info["aspect_ratio"]}
    if calidad != "fast":
        config_imagen["imageSize"] = "2K" if calidad == "balanced" else "4K"
    datos = comun.gemini(modelo, {
        "contents": [{"parts": [{"text": info["prompt"]}]}],
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"], "imageConfig": config_imagen},
    })
    for parte in datos.get("candidates", [{}])[0].get("content", {}).get("parts", []):
        inline = parte.get("inlineData") or parte.get("inline_data")
        if inline and inline.get("data"):
            mime = inline.get("mimeType") or inline.get("mime_type") or "image/png"
            if mime == "image/jpeg":
                info["imagen"] = info["imagen"].with_suffix(".jpg")
            elif mime == "image/webp":
                info["imagen"] = info["imagen"].with_suffix(".webp")
            info["imagen"].parent.mkdir(parents=True, exist_ok=True)
            info["imagen"].write_bytes(base64.b64decode(inline["data"]))
            return info["imagen"].resolve().as_uri(), f"api:{modelo}"
    motivo = datos.get("promptFeedback", {}).get("blockReason") or "sin imagen en la respuesta"
    raise RuntimeError(f"Gemini no devolvió imagen ({motivo})")


# --------------------------------------------------------------------------- flujo

def procesar(ruta: Path, via: str, calidad: str, dry_run: bool, forzar: bool) -> bool:
    info = leer_guion(ruta)
    nombre = ruta.relative_to(comun.RAIZ) if ruta.is_relative_to(comun.RAIZ) else ruta
    print(f"== {nombre}")
    if not info["descripcion"]:
        print("   Sin sección '## Imagen sugerida' (o está vacía): nada que hacer.")
        return True
    if info["txt"].exists() and not forzar:
        print(f"   Ya generada ({info['txt'].name}). Usa --forzar para regenerar.")
        return True
    if info["base_sin_rellenar"]:
        print("   Aviso: el prompt base de estilo-visual aún tiene placeholders [SIN_RELLENAR].")

    if dry_run:
        print(f"   [dry-run] aspect_ratio {info['aspect_ratio']} (publicar a {info['dimensiones']}), calidad {calidad}, vía {via}")
        print(f"   [dry-run] imagen -> {info['imagen'].relative_to(comun.RAIZ)}")
        print(f"   [dry-run] url    -> {info['txt'].relative_to(comun.RAIZ)}")
        print(f"   [dry-run] prompt: {info['prompt']}")
        return True

    for metodo in (["mcp", "api"] if via == "auto" else [via]):
        try:
            url, usado = (generar_via_mcp if metodo == "mcp" else generar_via_api)(info, calidad)
            break
        except Exception as e:  # noqa: BLE001 - se informa y se prueba la siguiente vía
            print(f"   Falló la vía {metodo}: {e}", file=sys.stderr)
    else:
        print("   ERROR: no se pudo generar la imagen.", file=sys.stderr)
        return False

    info["txt"].write_text(
        f"{url}\n"
        f"# guion: {info['guion'].name}\n"
        f"# imagen: {info['imagen'].relative_to(comun.RAIZ)}\n"
        f"# via: {usado}\n"
        f"# prompt: {info['prompt']}\n",
        encoding="utf-8",
    )
    print(f"   OK ({usado}) {url}")
    return True


def main() -> int:
    comun.cargar_env()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("guiones", nargs="*", type=Path)
    parser.add_argument("--pendientes", action="store_true", help="Todos los guiones sin .txt")
    parser.add_argument("--via", choices=["auto", "mcp", "api"], default=os.environ.get("POPMAKER_VIA", "auto"))
    parser.add_argument("--calidad", choices=list(MODELOS), default=os.environ.get("POPMAKER_CALIDAD", "fast"),
                        help="fast (1K, defecto) | balanced (2K) | quality (4K, lento)")
    parser.add_argument("--dry-run", action="store_true", help="Muestra qué haría sin generar nada")
    parser.add_argument("--forzar", action="store_true", help="Regenera aunque ya exista el .txt")
    args = parser.parse_args()

    guiones = [g.resolve() for g in args.guiones]
    if args.pendientes:
        guiones += [g for g in sorted(comun.DIR_GUIONES.glob("*.md")) if not g.with_suffix(".txt").exists()]
    if not guiones:
        print("No hay guiones que procesar." if args.pendientes else "Indica un guion o usa --pendientes.")
        return 0
    resultados = [procesar(g, args.via, args.calidad, args.dry_run, args.forzar) for g in guiones]
    return 0 if all(resultados) else 1


if __name__ == "__main__":
    sys.exit(main())
