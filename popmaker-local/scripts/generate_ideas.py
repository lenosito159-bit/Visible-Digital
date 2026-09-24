#!/usr/bin/env python3
"""Banco de ideas: contexto para generar ideas nuevas y guardado sin duplicados.

Solo usa la biblioteca estándar.

Uso:
    python3 scripts/generate_ideas.py contexto --tema "productividad freelance"
    python3 scripts/generate_ideas.py guardar --tema "..." --archivo ideas.md [--forzar]
    python3 scripts/generate_ideas.py guardar --tema "..." < ideas.md
    python3 scripts/generate_ideas.py listar [--dias 30]
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DIR_IDEAS = RAIZ / "data" / "ideas"
DIR_REFERENCIAS = RAIZ / "data" / "referencias"
ARCHIVO_IDEAS = re.compile(r"^(\d{4}-\d{2}-\d{2})_ideas\.md$")
CAMPO = re.compile(r"^-\s*\*\*(?P<clave>[^*:]+):?\*\*:?\s*(?P<valor>.*)$")
ID_IDEA = re.compile(r"^<!--\s*id:\s*(\S+)\s*-->$")

# Umbral de similitud (0-1) a partir del cual una idea se considera duplicada.
UMBRAL_TITULO = 0.72
UMBRAL_ANGULO = 0.80
PALABRAS_VACIAS = {
    "a", "al", "con", "de", "del", "el", "en", "es", "la", "las", "lo", "los",
    "para", "por", "que", "se", "sin", "su", "tu", "un", "una", "y", "o", "como",
    "mas", "no", "te", "tus", "mi", "sus",
}


@dataclass
class Idea:
    titulo: str
    campos: dict[str, str] = field(default_factory=dict)
    id: str | None = None
    archivo: str | None = None

    @property
    def angulo(self) -> str:
        return self.campos.get("angulo", "")


def normalizar(texto: str) -> str:
    texto = unicodedata.normalize("NFKD", texto.lower())
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9 ]+", " ", texto).strip()


def tokens(texto: str) -> set[str]:
    # Singular aproximado ("portfolios" -> "portfolio") para comparar mejor.
    return {
        t[:-1] if len(t) > 4 and t.endswith("s") else t
        for t in normalizar(texto).split()
        if t not in PALABRAS_VACIAS and len(t) > 2
    }


def similitud(a: str, b: str) -> float:
    """Máximo entre similitud de secuencia y solapamiento de palabras clave."""
    na, nb = normalizar(a), normalizar(b)
    if not na or not nb:
        return 0.0
    secuencia = SequenceMatcher(None, na, nb).ratio()
    ta, tb = tokens(a), tokens(b)
    jaccard = len(ta & tb) / len(ta | tb) if ta and tb else 0.0
    return max(secuencia, jaccard)


def parsear_ideas(texto: str, archivo: str | None = None) -> list[Idea]:
    ideas: list[Idea] = []
    actual: Idea | None = None
    for linea in texto.splitlines():
        linea = linea.strip()
        if linea.startswith("### "):
            actual = Idea(titulo=linea[4:].strip(), archivo=archivo)
            ideas.append(actual)
            continue
        if actual is None:
            continue
        if m := ID_IDEA.match(linea):
            actual.id = m.group(1)
        elif m := CAMPO.match(linea):
            clave = normalizar(m.group("clave")).replace(" ", "_")
            actual.campos[clave] = m.group("valor").strip()
    return ideas


def cargar_banco() -> list[Idea]:
    banco: list[Idea] = []
    if not DIR_IDEAS.is_dir():
        return banco
    for ruta in sorted(DIR_IDEAS.glob("*_ideas.md")):
        banco.extend(parsear_ideas(ruta.read_text(encoding="utf-8"), ruta.name))
    return banco


def buscar_duplicado(idea: Idea, banco: list[Idea]) -> tuple[Idea, float] | None:
    mejor: tuple[Idea, float] | None = None
    for existente in banco:
        s_titulo = similitud(idea.titulo, existente.titulo)
        s_angulo = similitud(idea.angulo, existente.angulo) if idea.angulo and existente.angulo else 0.0
        if s_titulo >= UMBRAL_TITULO or s_angulo >= UMBRAL_ANGULO:
            puntuacion = max(s_titulo, s_angulo)
            if mejor is None or puntuacion > mejor[1]:
                mejor = (existente, puntuacion)
    return mejor


def leer_config_simple(ruta: Path, clave: str) -> str | None:
    """Lee `clave: valor` de un YAML sencillo sin depender de PyYAML."""
    if not ruta.is_file():
        return None
    patron = re.compile(rf"^\s*{re.escape(clave)}:\s*([^#\n]+)")
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        if m := patron.match(linea):
            return m.group(1).strip().strip('"')
    return None


def plataformas_activas() -> list[str]:
    ruta = RAIZ / "config" / "plataformas.yaml"
    if not ruta.is_file():
        return []
    activas, actual = [], None
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        if m := re.match(r"^([a-z_]+):\s*$", linea):
            actual = m.group(1)
        elif actual and re.match(r"^\s+activa:\s*true", linea):
            activas.append(actual)
    return activas


def cmd_contexto(args: argparse.Namespace) -> int:
    banco = cargar_banco()
    config = RAIZ / "config" / "brand_voice.yaml"
    print(f"# Contexto para el tema: {args.tema}\n")
    print(f"- Ideas por defecto: {leer_config_simple(config, 'ideas_por_defecto') or 5}")
    print(f"- Plataformas activas: {', '.join(plataformas_activas()) or '(ninguna)'}")
    print(f"- Ideas en el banco: {len(banco)}\n")

    parecidas = sorted(
        ((i, similitud(args.tema, f"{i.titulo} {i.angulo}")) for i in banco),
        key=lambda par: par[1],
        reverse=True,
    )
    parecidas = [(i, s) for i, s in parecidas[: args.max_parecidas] if s > 0.2]
    print("## Ideas previas más parecidas al tema\n")
    if parecidas:
        for idea, s in parecidas:
            print(f"- [{idea.id or 's/id'}] {idea.titulo} — ángulo: {idea.angulo or '-'} ({s:.0%})")
    else:
        print("- (ninguna)")

    print("\n## Todos los títulos del banco (no repetir)\n")
    if banco:
        for idea in banco:
            print(f"- [{idea.id or 's/id'}] {idea.titulo}")
    else:
        print("- (banco vacío)")

    print("\n## Referencias en data/referencias/\n")
    referencias = [
        p for p in sorted(DIR_REFERENCIAS.rglob("*")) if p.is_file() and not p.name.startswith(".")
    ] if DIR_REFERENCIAS.is_dir() else []
    if referencias:
        for ruta in referencias:
            print(f"- {ruta.relative_to(RAIZ)}")
    else:
        print("- (sin referencias)")
    return 0


def siguiente_numero(ruta: Path, prefijo: str) -> int:
    if not ruta.is_file():
        return 1
    numeros = [
        int(m.group(1))
        for m in re.finditer(rf"<!--\s*id:\s*{prefijo}-(\d+)\s*-->", ruta.read_text(encoding="utf-8"))
    ]
    return max(numeros, default=0) + 1


def formatear_idea(idea: Idea) -> str:
    etiquetas = {
        "angulo": "Ángulo",
        "plataforma": "Plataforma",
        "formato": "Formato",
        "hook": "Hook",
        "por_que_funcionaria": "Por qué funcionaría",
    }
    lineas = [f"### {idea.titulo}", f"<!-- id: {idea.id} -->"]
    for clave, valor in idea.campos.items():
        lineas.append(f"- **{etiquetas.get(clave, clave.replace('_', ' ').capitalize())}:** {valor}")
    if "estado" not in idea.campos:
        lineas.append("- **Estado:** pendiente")
    return "\n".join(lineas) + "\n"


def cmd_guardar(args: argparse.Namespace) -> int:
    texto = Path(args.archivo).read_text(encoding="utf-8") if args.archivo else sys.stdin.read()
    nuevas = parsear_ideas(texto)
    if not nuevas:
        print("No se encontró ninguna idea. Cada idea debe empezar con '### <título>'.", file=sys.stderr)
        return 1

    banco = cargar_banco()
    aceptadas: list[Idea] = []
    duplicadas: list[tuple[Idea, Idea, float]] = []
    for idea in nuevas:
        duplicado = buscar_duplicado(idea, banco + aceptadas)
        if duplicado and not args.forzar:
            duplicadas.append((idea, *duplicado))
        else:
            aceptadas.append(idea)

    hoy = dt.date.today()
    ruta = DIR_IDEAS / f"{hoy.isoformat()}_ideas.md"
    prefijo = hoy.strftime("%Y%m%d")
    numero = siguiente_numero(ruta, prefijo)
    for idea in aceptadas:
        idea.id = f"{prefijo}-{numero:02d}"
        numero += 1

    if aceptadas:
        DIR_IDEAS.mkdir(parents=True, exist_ok=True)
        nuevo = not ruta.exists()
        with ruta.open("a", encoding="utf-8") as f:
            if nuevo:
                f.write(f"# Ideas {hoy.isoformat()}\n")
            f.write(f"\n## Tema: {args.tema} ({dt.datetime.now():%H:%M})\n\n")
            f.write("\n".join(formatear_idea(i) for i in aceptadas))

    print(f"Guardadas {len(aceptadas)} ideas en {ruta.relative_to(RAIZ)}:")
    for idea in aceptadas:
        print(f"  [{idea.id}] {idea.titulo}")
    if duplicadas:
        print(f"\nDescartadas {len(duplicadas)} por parecerse a ideas existentes:")
        for idea, existente, s in duplicadas:
            print(f"  - '{idea.titulo}' ≈ [{existente.id or 's/id'}] '{existente.titulo}' ({s:.0%})")
        print("Propón ideas nuevas para sustituirlas (o usa --forzar para guardarlas igualmente).")
    return 0


def cmd_listar(args: argparse.Namespace) -> int:
    limite = dt.date.today() - dt.timedelta(days=args.dias) if args.dias else None
    for ruta in sorted(DIR_IDEAS.glob("*_ideas.md")) if DIR_IDEAS.is_dir() else []:
        m = ARCHIVO_IDEAS.match(ruta.name)
        if limite and m and dt.date.fromisoformat(m.group(1)) < limite:
            continue
        for idea in parsear_ideas(ruta.read_text(encoding="utf-8")):
            estado = idea.campos.get("estado", "-")
            print(f"[{idea.id or 's/id'}] {idea.titulo} · {idea.campos.get('plataforma', '-')} · {estado}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="comando", required=True)

    p = sub.add_parser("contexto", help="Muestra banco de ideas y referencias para un tema")
    p.add_argument("--tema", required=True)
    p.add_argument("--max-parecidas", type=int, default=5)
    p.set_defaults(func=cmd_contexto)

    p = sub.add_parser("guardar", help="Añade ideas al archivo del día, descartando duplicados")
    p.add_argument("--tema", required=True)
    p.add_argument("--archivo", help="Markdown con las ideas (por defecto, stdin)")
    p.add_argument("--forzar", action="store_true", help="Guardar también las posibles duplicadas")
    p.set_defaults(func=cmd_guardar)

    p = sub.add_parser("listar", help="Lista las ideas del banco")
    p.add_argument("--dias", type=int, help="Solo las de los últimos N días")
    p.set_defaults(func=cmd_listar)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
