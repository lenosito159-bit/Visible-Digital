#!/usr/bin/env python3
"""Banco de ideas de contenido. Funciona con o sin Claude.

  generar   Genera ideas SIN Claude, con la API de Gemini (usa GEMINI_API_KEY).
  contexto  Muestra el banco y las referencias (lo usa la skill generador-ideas).
  guardar   Guarda ideas escritas por Claude, descartando duplicados.
  listar    Lista las ideas guardadas.
  estado    Cambia el estado de una idea (pendiente -> guion -> publicado).

Ejemplos:
  python3 scripts/generate_ideas.py generar --tema "precios freelance" --plataforma linkedin --cantidad 3
  python3 scripts/generate_ideas.py generar --tema "precios freelance" --dry-run
  python3 scripts/generate_ideas.py guardar --tema "precios freelance" --archivo /tmp/ideas.md

Decisiones de diseño:
- Las ideas se guardan en Markdown legible (data/ideas/YYYY-MM-DD_ideas.md), no en
  una base de datos: puedes editarlas a mano y verlas en git.
- Cada idea recibe un ID YYYYMMDD-NN para enlazarla con su guion.
- La detección de duplicados es deliberadamente simple (similitud de texto del título
  y del ángulo). Suficiente para no repetirse; no pretende entender semántica.
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import comun  # noqa: E402
import metricas  # noqa: E402

UMBRAL_DUPLICADO = 0.72
PALABRAS_VACIAS = set("a al con de del el en es la las lo los para por que se sin su tu un una y o como mas no te tus mi sus".split())
CAMPO = re.compile(r"^-\s*\*\*(?P<clave>[^*:]+):?\*\*:?\s*(?P<valor>.*)$")
ID_IDEA = re.compile(r"^<!--\s*id:\s*(\S+)\s*-->$")
ETIQUETAS = {"angulo": "Ángulo", "plataforma": "Plataforma", "hook": "Hook",
             "por_que_funcionaria": "Por qué funcionaría", "estado": "Estado"}


@dataclass
class Idea:
    titulo: str
    campos: dict[str, str] = field(default_factory=dict)
    id: str | None = None

    @property
    def angulo(self) -> str:
        return self.campos.get("angulo", "")


def _clave(texto: str) -> str:
    return comun.slugify(texto, 60).replace("-", "_")


def _tokens(texto: str) -> set[str]:
    palabras = comun.slugify(texto, 500).split("-")
    # Singular aproximado ("portfolios" -> "portfolio") para comparar mejor.
    return {p[:-1] if len(p) > 4 and p.endswith("s") else p
            for p in palabras if p not in PALABRAS_VACIAS and len(p) > 2}


def similitud(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    secuencia = SequenceMatcher(None, comun.slugify(a, 500), comun.slugify(b, 500)).ratio()
    ta, tb = _tokens(a), _tokens(b)
    jaccard = len(ta & tb) / len(ta | tb) if ta and tb else 0.0
    return max(secuencia, jaccard)


def parsear(texto: str) -> list[Idea]:
    ideas: list[Idea] = []
    for linea in texto.splitlines():
        linea = linea.strip()
        if linea.startswith("### "):
            ideas.append(Idea(titulo=linea[4:].strip()))
        elif ideas and (m := ID_IDEA.match(linea)):
            ideas[-1].id = m.group(1)
        elif ideas and (m := CAMPO.match(linea)):
            ideas[-1].campos[_clave(m.group("clave"))] = m.group("valor").strip()
    return ideas


def banco() -> list[Idea]:
    return [i for ruta in sorted(comun.DIR_IDEAS.glob("*_ideas.md"))
            for i in parsear(ruta.read_text(encoding="utf-8"))]


def duplicado_de(idea: Idea, existentes: list[Idea]) -> tuple[Idea, float] | None:
    mejor = None
    for otra in existentes:
        s = max(similitud(idea.titulo, otra.titulo), similitud(idea.angulo, otra.angulo))
        if s >= UMBRAL_DUPLICADO and (mejor is None or s > mejor[1]):
            mejor = (otra, s)
    return mejor


def guardar(tema: str, nuevas: list[Idea], forzar: bool = False) -> tuple[list[Idea], list[str]]:
    """Añade las ideas no duplicadas al archivo del día. Devuelve (guardadas, avisos)."""
    existentes = banco()
    aceptadas, avisos = [], []
    for idea in nuevas:
        dup = duplicado_de(idea, existentes + aceptadas)
        if dup and not forzar:
            avisos.append(f"'{idea.titulo}' se parece a [{dup[0].id}] '{dup[0].titulo}' ({dup[1]:.0%})")
        else:
            aceptadas.append(idea)
    if not aceptadas:
        return [], avisos

    hoy = dt.date.today()
    ruta = comun.DIR_IDEAS / f"{hoy.isoformat()}_ideas.md"
    prefijo = hoy.strftime("%Y%m%d")
    usados = re.findall(rf"<!--\s*id:\s*{prefijo}-(\d+)", ruta.read_text(encoding="utf-8")) if ruta.exists() else []
    siguiente = max(map(int, usados), default=0) + 1

    bloques = []
    for idea in aceptadas:
        idea.id = f"{prefijo}-{siguiente:02d}"
        siguiente += 1
        idea.campos.setdefault("estado", "pendiente")
        lineas = [f"### {idea.titulo}", f"<!-- id: {idea.id} -->"]
        lineas += [f"- **{ETIQUETAS.get(k, k.replace('_', ' ').capitalize())}:** {v}" for k, v in idea.campos.items()]
        bloques.append("\n".join(lineas))

    comun.DIR_IDEAS.mkdir(parents=True, exist_ok=True)
    with ruta.open("a", encoding="utf-8") as f:
        if f.tell() == 0:
            f.write(f"# Ideas {hoy.isoformat()}\n")
        f.write(f"\n## Tema: {tema} ({dt.datetime.now():%H:%M})\n\n" + "\n\n".join(bloques) + "\n")
    return aceptadas, avisos


def cambiar_estado(id_idea: str, estado: str, solo_si: str | None = None) -> bool:
    """Actualiza la línea '- **Estado:**' de la idea con ese ID. True si la cambia.
    Con solo_si, solo cambia si el estado actual es ese (no rebaja 'publicado' a 'guion')."""
    for ruta in sorted(comun.DIR_IDEAS.glob("*_ideas.md")):
        texto = ruta.read_text(encoding="utf-8")
        m = re.search(rf"<!--\s*id:\s*{re.escape(id_idea)}\s*-->.*?(?=^#{{2,3}}\s|\Z)", texto, re.MULTILINE | re.DOTALL)
        if not m:
            continue
        bloque = m.group(0)
        actual = re.search(r"^- \*\*Estado:\*\*\s*(.*)$", bloque, re.MULTILINE)
        if solo_si and (actual.group(1).strip() if actual else "pendiente") != solo_si:
            return False
        if re.search(r"^- \*\*Estado:\*\*.*$", bloque, re.MULTILINE):
            nuevo = re.sub(r"^- \*\*Estado:\*\*.*$", f"- **Estado:** {estado}", bloque, count=1, flags=re.MULTILINE)
        else:
            nuevo = bloque.rstrip("\n") + f"\n- **Estado:** {estado}\n"
        ruta.write_text(texto[: m.start()] + nuevo + texto[m.end():], encoding="utf-8")
        return True
    return False


def plan_cta(n: int) -> list[str]:
    """Tipo de CTA de las próximas n piezas según oferta.frecuencia de brand_voice.yaml."""
    oferta = comun.cargar_yaml("brand_voice.yaml").get("oferta") or {}
    hechas = len(list(comun.DIR_GUIONES.glob("*.md")))
    activa = oferta.get("activa") and oferta.get("nombre") and oferta.get("enlace")
    frecuencia = max(int(oferta.get("frecuencia") or 3), 1)
    return ["oferta" if activa and (hechas + i) % frecuencia == 0 else "audiencia" for i in range(1, n + 1)]


def informar(guardadas: list[Idea], avisos: list[str]) -> None:
    ruta = comun.DIR_IDEAS / f"{dt.date.today().isoformat()}_ideas.md"
    print(f"Guardadas {len(guardadas)} idea(s) en {ruta.relative_to(comun.RAIZ)}")
    for idea in guardadas:
        print(f"  [{idea.id}] {idea.titulo}")
    if avisos:
        print(f"Descartadas {len(avisos)} por duplicadas (usa --forzar para guardarlas):")
        for aviso in avisos:
            print(f"  - {aviso}")


def construir_prompt(tema: str, plataforma: str, cantidad: int) -> str:
    voz = comun.cargar_yaml("brand_voice.yaml")
    spec = comun.plataforma(plataforma)
    plantilla = (comun.DIR_CONFIG / "prompts" / "idea_prompt.md").read_text(encoding="utf-8")
    plantilla = re.sub(r"<!--.*?-->\s*", "", plantilla, flags=re.DOTALL)
    existentes = "\n".join(f"- {i.titulo}" for i in banco()) or "- (ninguna)"
    valores = {
        "marca": voz.get("marca", {}).get("nombre", ""),
        "audiencia": voz.get("marca", {}).get("audiencia", ""),
        "tono": voz.get("tono", {}).get("registro") or voz.get("tono", {}).get("principal", ""),
        "tema": tema,
        "plataforma": plataforma,
        "tipo_contenido": spec.get("tipo_contenido", ""),
        "cantidad": str(cantidad),
        "ideas_existentes": existentes,
    }
    return re.sub(r"\{\{(\w+)\}\}", lambda m: valores.get(m.group(1), m.group(0)), plantilla)


def cmd_generar(args: argparse.Namespace) -> int:
    prompt = construir_prompt(args.tema, args.plataforma, args.cantidad)
    if args.dry_run:
        print(f"[dry-run] Modelo: {comun.MODELO_TEXTO}")
        print(f"[dry-run] Destino: data/ideas/{dt.date.today().isoformat()}_ideas.md")
        print("[dry-run] Prompt que se enviaría:\n")
        print(prompt)
        return 0
    try:
        respuesta = comun.texto_gemini(prompt)
    except RuntimeError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2
    ideas = parsear(respuesta)
    if not ideas:
        print("El modelo no devolvió ideas en el formato esperado. Respuesta:\n" + respuesta, file=sys.stderr)
        return 1
    for idea in ideas:
        idea.campos["plataforma"] = args.plataforma
    informar(*guardar(args.tema, ideas[: args.cantidad], args.forzar))
    return 0


def cmd_contexto(args: argparse.Namespace) -> int:
    ideas = banco()
    print(f"# Contexto para: {args.tema}\n")
    print(f"Plataformas disponibles: {', '.join(comun.plataformas())}\n")
    print("## Ideas del banco (no repetir)\n")
    ordenadas = sorted(ideas, key=lambda i: similitud(args.tema, f"{i.titulo} {i.angulo}"), reverse=True)
    for idea in ordenadas or []:
        print(f"- [{idea.id}] {idea.titulo} — {idea.angulo or 'sin ángulo'}")
    if not ideas:
        print("- (banco vacío)")
    print("\n## Lo que mejor ha funcionado (data/metricas.csv)\n")
    top = metricas.mejores(5)
    for fila in top:
        print(f"- {fila['titulo']} ({fila['plataforma']}, puntuación {fila['puntuacion']}, "
              f"guardados {fila['guardados'] or 0}, ventas {fila['ventas'] or 0})")
    if top:
        print("Propón ángulos y hooks parecidos a estos (sin repetirlos).")
    else:
        print("- (sin métricas todavía)")

    oferta = comun.cargar_yaml("brand_voice.yaml").get("oferta") or {}
    print("\n## CTA de las próximas piezas\n")
    for i, tipo in enumerate(plan_cta(args.cantidad), 1):
        if tipo == "oferta":
            print(f"- Pieza {i}: OFERTA -> \"{oferta.get('nombre')}\" ({oferta.get('enlace')}). "
                  "Pon `cta: oferta` en el frontmatter e incluye el enlace.")
        else:
            print(f"- Pieza {i}: audiencia (guardar, compartir o seguir). `cta: audiencia`.")

    print("\n## Referencias (data/referencias/)\n")
    refs = [p for p in sorted(comun.DIR_REFERENCIAS.rglob("*")) if p.is_file() and not p.name.startswith(".")]
    for ruta in refs:
        print(f"- {ruta.relative_to(comun.RAIZ)}")
    if not refs:
        print("- (sin referencias)")
    return 0


def cmd_guardar(args: argparse.Namespace) -> int:
    texto = Path(args.archivo).read_text(encoding="utf-8") if args.archivo else sys.stdin.read()
    ideas = parsear(texto)
    if not ideas:
        print("No hay ideas: cada una debe empezar con '### <título>'.", file=sys.stderr)
        return 1
    informar(*guardar(args.tema, ideas, args.forzar))
    return 0


def cmd_listar(_: argparse.Namespace) -> int:
    for idea in banco():
        print(f"[{idea.id}] {idea.titulo} · {idea.campos.get('plataforma', '-')} · {idea.campos.get('estado', '-')}")
    return 0


def main() -> int:
    comun.cargar_env()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="comando", required=True)

    p = sub.add_parser("generar", help="Genera ideas con Gemini (sin Claude)")
    p.add_argument("--tema", required=True)
    p.add_argument("--plataforma", default="linkedin", choices=list(comun.plataformas()))
    p.add_argument("--cantidad", type=int, default=3)
    p.add_argument("--forzar", action="store_true", help="Guardar también las posibles duplicadas")
    p.add_argument("--dry-run", action="store_true", help="Muestra el prompt sin llamar a la API")
    p.set_defaults(func=cmd_generar)

    p = sub.add_parser("contexto", help="Banco de ideas, métricas, CTA y referencias para un tema")
    p.add_argument("--tema", required=True)
    p.add_argument("--cantidad", type=int, default=1, help="Piezas que se van a crear (para el plan de CTA)")
    p.set_defaults(func=cmd_contexto)

    p = sub.add_parser("guardar", help="Guarda ideas en Markdown (archivo o stdin)")
    p.add_argument("--tema", required=True)
    p.add_argument("--archivo")
    p.add_argument("--forzar", action="store_true")
    p.set_defaults(func=cmd_guardar)

    p = sub.add_parser("listar", help="Lista el banco de ideas")
    p.set_defaults(func=cmd_listar)

    p = sub.add_parser("estado", help="Cambia el estado de una idea")
    p.add_argument("--id", required=True)
    p.add_argument("--valor", required=True, help="ej.: guion, publicado, descartada")
    p.add_argument("--solo-si", help="Cambiar solo si el estado actual es este")
    p.set_defaults(func=lambda a: 0 if cambiar_estado(a.id, a.valor, a.solo_si) else 1)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
