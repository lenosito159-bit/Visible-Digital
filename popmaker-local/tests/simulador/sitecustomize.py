"""Simula la API de Gemini para los tests: ningún test gasta créditos ni necesita red.

Se carga solo en los subprocesos de los tests (PYTHONPATH=tests/simulador).
Texto -> devuelve 2 ideas fijas. Imagen -> devuelve un PNG mínimo.
Guarda cada petición en $POPMAKER_TEST_LOG para que los tests la inspeccionen.
POPMAKER_TEST_ERROR="503" hace fallar la primera petición con 503 (luego responde bien);
POPMAKER_TEST_ERROR="429" hace fallar todas con 429 (cuota agotada).
"""
import base64
import io
import json
import os
import urllib.error
import urllib.request

IDEAS = """### Tu mañana no necesita 14 pasos, necesita 3
- **Ángulo:** rutina mínima frente a rutinas de influencer
- **Plataforma:** instagram
- **Hook:** Esto es lo que nadie te dice de las rutinas de mañana.
- **Por qué funcionaría:** alivia la culpa de no tener una rutina perfecta.

### El bloque de 90 minutos que me subió la facturación
- **Ángulo:** caso real con números
- **Plataforma:** instagram
- **Hook:** 90 minutos sin móvil. Un 30 % más facturado.
- **Por qué funcionaría:** número concreto, no teoría.
"""
PNG = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f3d0000000049454e44ae426082")).decode()


class _Respuesta(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _error(codigo, mensaje):
    cuerpo = json.dumps({"error": {"code": codigo, "message": mensaje}}).encode()
    return urllib.error.HTTPError("https://gemini", codigo, mensaje, {}, io.BytesIO(cuerpo))


def _falso(peticion, timeout=0):
    cuerpo = json.loads(peticion.data)
    modo = os.environ.get("POPMAKER_TEST_ERROR", "")
    if modo == "429":
        raise _error(429, "You exceeded your current quota, please check your plan and billing details.")
    if modo == "503" and not os.path.exists(os.environ["POPMAKER_TEST_LOG"] + ".503"):
        open(os.environ["POPMAKER_TEST_LOG"] + ".503", "w").close()
        raise _error(503, "This model is currently experiencing high demand.")
    if os.environ.get("POPMAKER_TEST_LOG"):
        with open(os.environ["POPMAKER_TEST_LOG"], "a", encoding="utf-8") as f:
            f.write(json.dumps({"url": peticion.full_url, "cuerpo": cuerpo}) + "\n")
    if "image" in peticion.full_url:
        partes = [{"inlineData": {"mimeType": "image/png", "data": PNG}}]
    else:
        partes = [{"text": IDEAS}]
    return _Respuesta(json.dumps({"candidates": [{"content": {"parts": partes}}]}).encode())


urllib.request.urlopen = _falso
