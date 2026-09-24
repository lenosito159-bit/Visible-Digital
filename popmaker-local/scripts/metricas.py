#!/usr/bin/env python3
"""Registro de resultados de cada pieza publicada y ranking de lo que funciona.

  registrar  Añade o actualiza los resultados de un guion en data/metricas.csv.
  ranking    Muestra las piezas con mejor puntuación.

Ejemplos:
  python3 scripts/metricas.py registrar data/output/guiones/<guion>.md \\
      --alcance 3200 --guardados 140 --compartidos 35 --seguidores 22 --clics 18 --ventas 2 --ingresos 38
  python3 scripts/metricas.py ranking --top 5

Decisiones de diseño:
- Un CSV (data/metricas.csv) y no una base de datos: lo puedes abrir y editar en
  Excel, Numbers o Google Sheets.
- La puntuación prioriza lo que acerca a ingresos (ventas, clics, seguidores) sobre la
  vanidad (alcance). Los pesos están en PESOS: cámbialos si tu negocio mide otra cosa.
- `generate_ideas.py contexto` usa este ranking para que Claude proponga ideas
  parecidas a las que mejor han funcionado.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import comun  # noqa: E402

ARCHIVO = comun.RAIZ / "data" / "metricas.csv"
METRICAS = ["alcance", "guardados", "compartidos", "comentarios", "seguidores", "clics", "ventas", "ingresos"]
COLUMNAS = ["fecha_registro", "guion", "idea_id", "titulo", "plataforma", "cta", *METRICAS]
PESOS = {"ingresos": 10, "ventas": 20, "clics": 3, "seguidores": 5,
         "guardados": 2, "compartidos": 3, "comentarios": 1, "alcance": 0.01}


def leer() -> list[dict]:
    if not ARCHIVO.is_file():
        return []
    with ARCHIVO.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def escribir(filas: list[dict]) -> None:
    ARCHIVO.parent.mkdir(parents=True, exist_ok=True)
    with ARCHIVO.open("w", encoding="utf-8", newline="") as f:
        escritor = csv.DictWriter(f, fieldnames=COLUMNAS)
        escritor.writeheader()
        escritor.writerows(filas)


def numero(valor) -> float:
    try:
        return float(str(valor).replace(",", "."))
    except ValueError:
        return 0.0


def puntuacion(fila: dict) -> float:
    return sum(numero(fila.get(m, 0)) * peso for m, peso in PESOS.items())


def mejores(top: int = 5) -> list[dict]:
    filas = sorted(leer(), key=puntuacion, reverse=True)
    return [dict(f, puntuacion=round(puntuacion(f), 1)) for f in filas[:top] if puntuacion(f) > 0]


def cmd_registrar(args: argparse.Namespace) -> int:
    ruta = Path(args.guion)
    if not ruta.is_file():
        print(f"No existe el guion: {ruta}", file=sys.stderr)
        return 1
    texto = ruta.read_text(encoding="utf-8")
    meta = dict(re.findall(r"^(\w+):\s*(.+)$", texto.split("\n---", 1)[0], re.MULTILINE))

    filas = [f for f in leer() if f["guion"] != ruta.name]  # re-registrar = actualizar
    nueva = {
        "fecha_registro": dt.date.today().isoformat(),
        "guion": ruta.name,
        "idea_id": meta.get("idea_id", ""),
        "titulo": meta.get("titulo", ""),
        "plataforma": meta.get("plataforma", ""),
        "cta": meta.get("cta", ""),
        **{m: getattr(args, m) for m in METRICAS},
    }
    filas.append(nueva)
    escribir(filas)
    print(f"Registrado {ruta.name} · puntuación {puntuacion(nueva):.1f}")

    if nueva["idea_id"]:  # la idea pasa a "publicada" en el banco
        import generate_ideas
        generate_ideas.cambiar_estado(nueva["idea_id"], "publicado")
    return 0


def cmd_ranking(args: argparse.Namespace) -> int:
    filas = mejores(args.top)
    if not filas:
        print("Aún no hay métricas. Regístralas con: python3 scripts/metricas.py registrar <guion> --guardados N ...")
        return 0
    print(f"{'Punt.':>7}  {'Plataforma':<10} {'CTA':<9} {'Ingresos':>8}  Título")
    for f in filas:
        print(f"{f['puntuacion']:>7}  {f['plataforma']:<10} {f['cta'] or '-':<9} {numero(f['ingresos']):>8.0f}  {f['titulo']}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="comando", required=True)

    p = sub.add_parser("registrar", help="Guarda los resultados de un guion publicado")
    p.add_argument("guion")
    for m in METRICAS:
        p.add_argument(f"--{m}", type=float, default=0)
    p.set_defaults(func=cmd_registrar)

    p = sub.add_parser("ranking", help="Piezas con mejor puntuación")
    p.add_argument("--top", type=int, default=10)
    p.set_defaults(func=cmd_ranking)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
