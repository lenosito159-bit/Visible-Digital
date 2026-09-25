"""Tests de popmaker-local. No gastan créditos: Gemini está simulado (tests/simulador).

    python3 -m unittest discover -s tests -v

Decisión de diseño: cada test trabaja sobre una copia del proyecto en un directorio
temporal y ejecuta los scripts como lo harías tú (subprocesos). Así se prueba el
comportamiento real, incluido el hook, sin tocar tus datos de data/.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

PROYECTO = Path(__file__).resolve().parent.parent
SIMULADOR = PROYECTO / "tests" / "simulador"

GUION_OK = textwrap.dedent("""\
    ---
    idea_id: {idea_id}
    titulo: Tu mañana no necesita 14 pasos
    plataforma: instagram
    cta: {cta}
    fecha: 2026-01-01
    ---

    # Tu mañana no necesita 14 pasos

    ## Hook
    Esto es lo que nadie te dice de las rutinas.

    ## Desarrollo
    ### Slide 1
    Tu mañana no necesita 14 pasos. Necesita 3.
    ### Slide 2
    Probé la rutina de un influencer. Duré 9 días.
    ### Slide 3
    El problema no era madrugar. Era copiar.
    ### Slide 4
    Paso 1: nada de móvil la primera hora.
    ### Slide 5
    Paso 2: un bloque de 90 minutos de trabajo profundo.
    ### Slide 6
    Paso 3: revisar la agenda antes de comer.
    ### Slide 7
    {cierre}

    ## CTA
    {cierre}

    ## Copy de publicación
    Vamos al grano: tres pasos.

    ## Imagen sugerida
    A single coffee cup on a small desk next to a closed notebook, seen from above.
    """)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="popmaker-test-"))
        self.raiz = self.tmp / "popmaker-local"
        shutil.copytree(PROYECTO, self.raiz, ignore=shutil.ignore_patterns(
            ".env", "data", "__pycache__", "tests"))
        for d in ("data/ideas", "data/referencias", "data/output/guiones", "data/output/imagenes"):
            (self.raiz / d).mkdir(parents=True, exist_ok=True)
        self.log = self.tmp / "gemini.log"
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(("S3_", "POPMAKER_", "GEMINI"))}
        self.env.update(PYTHONPATH=str(SIMULADOR), GEMINI_API_KEY="clave-de-test",
                        POPMAKER_TEST_LOG=str(self.log), POPMAKER_VIA="api",
                        CLAUDE_PROJECT_DIR=str(self.raiz))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def ejecutar(self, *args, entrada=None, env=None):
        return subprocess.run([*args], cwd=self.raiz, env={**self.env, **(env or {})},
                              input=entrada, capture_output=True, text=True, timeout=120)

    def py(self, script, *args, **kw):
        return self.ejecutar(sys.executable, f"scripts/{script}", *args, **kw)

    def peticiones(self):
        if not self.log.exists():
            return []
        return [json.loads(l) for l in self.log.read_text().splitlines()]

    def guion(self, nombre="2026-01-01_instagram_rutina-3-pasos.md", cta="audiencia",
              cierre="Guárdalo para tu próxima mañana.", idea_id="20260101-01"):
        ruta = self.raiz / "data/output/guiones" / nombre
        ruta.write_text(GUION_OK.format(cta=cta, cierre=cierre, idea_id=idea_id), encoding="utf-8")
        return ruta

    def hook(self, ruta, **env):
        evento = json.dumps({"tool_name": "Write", "tool_input": {"file_path": str(ruta)}})
        return self.ejecutar(str(self.raiz / ".claude/hooks/on-write-generate-image.sh"), entrada=evento, env=env)


class TestConfiguracion(Base):
    def test_archivos_de_configuracion_validos(self):
        import yaml
        for nombre in ("brand_voice.yaml", "plataformas.yaml"):
            self.assertIsInstance(yaml.safe_load((self.raiz / "config" / nombre).read_text()), dict)
        json.loads((self.raiz / ".mcp.json").read_text())
        ajustes = json.loads((self.raiz / ".claude/settings.json").read_text())
        self.assertEqual(ajustes["hooks"]["PostToolUse"][0]["matcher"], "Write|Edit")

    def test_prompt_base_sin_placeholders_ni_formato_fijo(self):
        r = self.ejecutar(sys.executable, "-c",
                          "import sys; sys.path.insert(0,'scripts'); import comun; print(comun.prompt_base())")
        base = r.stdout.strip()
        self.assertIn("#1F2A44", base)
        self.assertNotIn("[", base)
        self.assertNotIn("aspect ratio", base, "el formato lo añade el script por plataforma")

    def test_aspect_ratios_admitidos_por_el_mcp(self):
        import yaml
        for nombre, spec in yaml.safe_load((self.raiz / "config/plataformas.yaml").read_text()).items():
            self.assertIn(spec["imagen"]["aspect_ratio"], {"1:1", "16:9", "9:16", "4:3", "3:4"}, nombre)


class TestIdeas(Base):
    def test_generar_guardar_y_descartar_duplicados(self):
        r = self.py("generate_ideas.py", "generar", "--tema", "rutinas", "--plataforma", "instagram", "--cantidad", "2")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Guardadas 2", r.stdout)
        prompt = self.peticiones()[0]["cuerpo"]["contents"][0]["parts"][0]["text"]
        self.assertIn("Productividad Freelance", prompt)
        r = self.py("generate_ideas.py", "generar", "--tema", "rutinas", "--plataforma", "instagram", "--cantidad", "2")
        self.assertIn("Descartadas 2", r.stdout)

    def test_dry_run_no_llama_a_la_api_ni_escribe(self):
        r = self.py("generate_ideas.py", "generar", "--tema", "rutinas", "--dry-run")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.peticiones(), [])
        self.assertEqual(list((self.raiz / "data/ideas").glob("*.md")), [])

    def test_estado_de_la_idea(self):
        self.py("generate_ideas.py", "generar", "--tema", "rutinas", "--plataforma", "instagram", "--cantidad", "1")
        id_idea = next(l.split("]")[0].strip(" [") for l in self.py("generate_ideas.py", "listar").stdout.splitlines())
        self.assertEqual(self.py("generate_ideas.py", "estado", "--id", id_idea, "--valor", "publicado").returncode, 0)
        # --solo-si pendiente no rebaja una idea ya publicada
        self.py("generate_ideas.py", "estado", "--id", id_idea, "--valor", "guion", "--solo-si", "pendiente")
        self.assertIn("publicado", self.py("generate_ideas.py", "listar").stdout)

    def test_plan_de_cta_con_oferta(self):
        voz = self.raiz / "config/brand_voice.yaml"
        voz.write_text(voz.read_text().replace('activa: false', 'activa: true')
                       .replace('nombre: ""', 'nombre: "Plantilla Notion"')
                       .replace('enlace: ""', 'enlace: "enlace en la bio"'))
        r = self.py("generate_ideas.py", "contexto", "--tema", "rutinas", "--cantidad", "3")
        self.assertEqual(r.stdout.count("OFERTA"), 1, r.stdout)  # 1 de cada 3


class TestValidador(Base):
    def test_guion_correcto(self):
        r = self.py("validar_guion.py", str(self.guion()))
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_detecta_slide_larga_y_prohibidas(self):
        ruta = self.guion(cierre="No obstante, guarda este carrusel porque te va a servir muchísimo "
                                 "en todas tus mañanas de trabajo a partir de ahora mismo")
        r = self.py("validar_guion.py", str(ruta))
        self.assertEqual(r.returncode, 1)
        self.assertIn("Slide 7", r.stdout)
        self.assertIn("No obstante", r.stdout)

    def test_detecta_numero_de_slides(self):
        ruta = self.guion()
        ruta.write_text(ruta.read_text().replace("### Slide 7\n", "Slide final\n"))
        self.assertIn("6 slides; deben ser 7-9", self.py("validar_guion.py", str(ruta)).stdout)

    def test_cta_de_oferta_sin_oferta_configurada(self):
        r = self.py("validar_guion.py", str(self.guion(cta="oferta")))
        self.assertIn("la oferta no está activa", r.stdout)


class TestImagenes(Base):
    def test_genera_imagen_y_txt_via_api(self):
        ruta = self.guion()
        r = self.py("generate_images.py", str(ruta))
        self.assertEqual(r.returncode, 0, r.stderr)
        imagen = self.raiz / "data/output/imagenes" / (ruta.stem + ".png")
        self.assertTrue(imagen.read_bytes().startswith(b"\x89PNG"))
        self.assertTrue(ruta.with_suffix(".txt").read_text().startswith("file://"))
        cuerpo = self.peticiones()[0]["cuerpo"]
        prompt = cuerpo["contents"][0]["parts"][0]["text"]
        self.assertTrue(prompt.startswith("A single coffee cup"))
        self.assertIn("#FAF7F2", prompt)
        self.assertIn("3:4 aspect ratio", prompt)
        self.assertEqual(cuerpo["generationConfig"]["imageConfig"]["aspectRatio"], "3:4")

    def test_no_regenera_si_existe_txt(self):
        ruta = self.guion()
        self.py("generate_images.py", str(ruta))
        self.py("generate_images.py", str(ruta))
        self.assertEqual(len(self.peticiones()), 1)

    def test_dry_run_no_genera(self):
        ruta = self.guion()
        r = self.py("generate_images.py", str(ruta), "--dry-run")
        self.assertIn("[dry-run] prompt:", r.stdout)
        self.assertEqual(self.peticiones(), [])
        self.assertFalse(ruta.with_suffix(".txt").exists())

    def test_cuota_agotada_explica_que_hacer(self):
        r = self.py("generate_images.py", str(self.guion()), env={"POPMAKER_TEST_ERROR": "429"})
        self.assertEqual(r.returncode, 1)
        self.assertIn("activa la facturación", r.stderr)
        self.assertEqual(r.stderr.count("activa la facturación"), 1, "el mensaje no debe duplicarse")

    def test_reintenta_si_gemini_esta_saturado(self):
        r = self.py("generate_images.py", str(self.guion()),
                    env={"POPMAKER_TEST_ERROR": "503", "POPMAKER_REINTENTOS": "0"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("reintento 1", r.stderr)

    def test_sin_clave_falla_con_mensaje_claro(self):
        r = self.py("generate_images.py", str(self.guion()), env={"GEMINI_API_KEY": ""})
        self.assertEqual(r.returncode, 1)
        self.assertIn("GEMINI_API_KEY", r.stderr + r.stdout)


class TestHook(Base):
    def test_hook_valida_genera_imagen_y_marca_idea(self):
        self.py("generate_ideas.py", "generar", "--tema", "rutinas", "--plataforma", "instagram", "--cantidad", "1")
        id_idea = self.py("generate_ideas.py", "listar").stdout.split("]")[0].strip("[ ")
        ruta = self.guion(idea_id=id_idea)
        r = self.hook(ruta)
        self.assertEqual(r.returncode, 0)
        contexto = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("Estilo: OK", contexto)
        self.assertTrue(ruta.with_suffix(".txt").exists())
        self.assertIn("guion", self.py("generate_ideas.py", "listar").stdout)

    def test_hook_ignora_otros_archivos_y_modo_off(self):
        self.assertEqual(self.hook(self.raiz / "README.md").stdout, "")
        ruta = self.guion()
        self.hook(ruta, POPMAKER_IMAGENES="off")
        self.assertFalse(ruta.with_suffix(".txt").exists())

    def test_hook_informa_de_problemas_de_estilo(self):
        ruta = self.guion(cierre="Sin duda alguna, guarda esto.")
        contexto = json.loads(self.hook(ruta).stdout)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("REVISAR", contexto)
        self.assertIn("Sin duda alguna", contexto)


class TestMetricas(Base):
    def test_registrar_ranking_y_contexto(self):
        self.py("generate_ideas.py", "generar", "--tema", "rutinas", "--plataforma", "instagram", "--cantidad", "2")
        ids = [l.split("]")[0].strip("[ ") for l in self.py("generate_ideas.py", "listar").stdout.splitlines()]
        a = self.guion("a.md", idea_id=ids[0])
        b = self.guion("b.md", idea_id=ids[1])
        self.assertEqual(self.py("metricas.py", "registrar", str(a), "--guardados", "10").returncode, 0)
        self.py("metricas.py", "registrar", str(b), "--guardados", "5", "--ventas", "2", "--ingresos", "38")
        ranking = self.py("metricas.py", "ranking").stdout.splitlines()
        self.assertIn("38", ranking[1], "la pieza con ventas va primero")
        self.assertIn("publicado", self.py("generate_ideas.py", "listar").stdout)
        self.assertIn("Lo que mejor ha funcionado", self.py("generate_ideas.py", "contexto", "--tema", "x").stdout)
        # re-registrar actualiza, no duplica
        self.py("metricas.py", "registrar", str(a), "--guardados", "50")
        self.assertEqual(len((self.raiz / "data/metricas.csv").read_text().strip().splitlines()), 3)


class TestWorkflow(Base):
    def test_modos_dry_run_y_errores(self):
        wf = str(self.raiz / "scripts/run_workflow.sh")
        self.assertEqual(self.ejecutar(wf).returncode, 1)
        r = self.ejecutar(wf, "--tema", "rutinas", "--sin-claude", "--dry-run")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn("[dry-run]", r.stdout)
        self.assertEqual(self.peticiones(), [])
        self.assertEqual(self.ejecutar(wf, "--solo-imagen", "--dry-run").returncode, 0)


if __name__ == "__main__":
    unittest.main()
