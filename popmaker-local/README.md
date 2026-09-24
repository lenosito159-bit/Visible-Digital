# PopMaker local

Sistema de generación de contenido (ideas → guiones → imágenes) que se ejecuta en tu
máquina con Claude Code como orquestador. Tu voz de marca y tu estilo visual viven en
skills, y las imágenes se generan con Gemini (Nano Banana) a través del servidor MCP
`mcp-media-toolkit`.

```
/generar-contenido --tema "..." --plataforma linkedin --cantidad 1
 │
 ├─ 1. carga skills voz-marca + estilo-visual
 ├─ 2. skill generador-ideas ──────────────▶ data/ideas/2026-09-24_ideas.md
 ├─ 3. guion (Write) ──────────────────────▶ data/output/guiones/2026-09-24_linkedin_<slug>.md
 │
 └─ hook PostToolUse (Write) ── scripts/generate_images.py
       ├─ 4. extrae "## Imagen sugerida"
       ├─ 5. + prompt base de estilo ─▶ MCP mcp-media-toolkit (si falla: API de Gemini)
       └─ 6. ─────────────────────────▶ data/output/imagenes/2026-09-24_linkedin_<slug>.png
                                        data/output/guiones/2026-09-24_linkedin_<slug>.txt  (URL)
```

## 1. Requisitos

- [Claude Code](https://code.claude.com): `npm install -g @anthropic-ai/claude-code`
- Node.js 18+ (el MCP se lanza con `npx`)
- Python 3.9+ y `pip install -r requirements.txt` (solo PyYAML)

## 2. Obtener las API keys

### Gemini (obligatoria)

1. Entra en [aistudio.google.com/apikey](https://aistudio.google.com/apikey) con tu cuenta de Google.
2. **Create API key** → elige o crea un proyecto de Google Cloud.
3. Copia la clave (`AIza…`) en `.env` como `GEMINI_API_KEY`.

La generación de imágenes suele requerir facturación activa en el proyecto. Precios:
[ai.google.dev/pricing](https://ai.google.dev/pricing).

### Almacenamiento S3 (opcional: para tener URLs públicas)

Sin S3, la imagen se guarda en local y el `.txt` contiene su ruta `file://`. Con S3,
contiene la URL pública. Hay que rellenar **todas** las `S3_*` o **ninguna**.

**Cloudflare R2** (recomendado: sin coste de descarga)
1. Panel de Cloudflare → **R2 Object Storage** → **Create bucket** (ej. `media`) → `S3_BUCKET`.
2. Copia tu **Account ID** → `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
3. **Manage R2 API Tokens** → **Create API token** con *Object Read & Write* sobre el bucket →
   `S3_ACCESS_KEY_ID` y `S3_SECRET_ACCESS_KEY` (solo se muestran una vez).
4. Bucket → **Settings** → **Public access**: conecta un dominio (`S3_PUBLIC_URL=https://media.tudominio.com`)
   o activa `r2.dev` (`https://pub-<hash>.r2.dev`).
5. `S3_REGION=auto`.

**AWS S3**: crea el bucket (anota la región), permite lectura pública con una bucket
policy de `s3:GetObject`, crea un usuario IAM con `s3:PutObject` y genera su access key.
`S3_ENDPOINT=https://s3.<region>.amazonaws.com`,
`S3_PUBLIC_URL=https://<bucket>.s3.<region>.amazonaws.com`, `S3_REGION=<region>`.

**MinIO** (todo local): `docker run -p 9000:9000 -p 9001:9001 minio/minio server /data --console-address ":9001"`,
crea bucket y access key en `http://localhost:9001`, y usa
`S3_ENDPOINT=http://localhost:9000`, `S3_PUBLIC_URL=http://localhost:9000/<bucket>`, `S3_REGION=us-east-1`.

## 3. Configurar el MCP

```bash
cd popmaker-local
pip install -r requirements.txt
cp .env.example .env              # pega GEMINI_API_KEY (y S3_* si quieres)
set -a; source .env; set +a       # Claude Code pasa estas variables al MCP
claude                            # 1.ª vez: acepta "trust this folder" y aprueba mcp-media-toolkit
```

Comprueba desde otra terminal (con las variables cargadas) o dentro de Claude con `/mcp`:

```bash
claude mcp list
# mcp-media-toolkit: npx -y mcp-media-toolkit@0.1.1 - ✓ Connected
```

## 4. Primera generación

1. Rellena los placeholders (sección 6). Puedes probar antes sin rellenarlos, pero la voz y
   el estilo serán genéricos.
2. Mira qué haría sin generar nada:
   ```
   /generar-contenido --tema "subir precios siendo freelance" --plataforma linkedin --cantidad 1 --dry-run
   ```
3. Ejecuta:
   ```
   /generar-contenido --tema "subir precios siendo freelance" --plataforma linkedin --cantidad 1
   ```
4. Revisa `data/output/guiones/` (guion + `.txt` con la URL) y `data/output/imagenes/`.

## 5. Modos de uso (sistema modular)

| Quiero… | Cómo |
| --- | --- |
| Todo (texto + imagen) | `/generar-contenido --tema "…"` |
| Solo texto | `/generar-contenido --tema "…" --solo-texto` |
| Solo imagen de un guion | `python3 scripts/generate_images.py data/output/guiones/<guion>.md` |
| Imágenes de todos los guiones pendientes | `python3 scripts/generate_images.py --pendientes` |
| Solo ideas, sin Claude | `python3 scripts/generate_ideas.py generar --tema "…" --plataforma tiktok --cantidad 5` |
| Revisar el estilo de un guion | `python3 scripts/validar_guion.py data/output/guiones/<guion>.md` |
| Ver qué haría (dry run) | añade `--dry-run` a cualquiera de los anteriores |
| Desatendido (cron/launchd) | `scripts/run_workflow.sh --tema "…"` (ver sección 7) |

Opciones de imagen (argumentos o variables en `.env`):
`--calidad fast|balanced|quality` (`POPMAKER_CALIDAD`), `--via auto|mcp|api` (`POPMAKER_VIA`),
`--forzar` para regenerar (o borra el `.txt`). `POPMAKER_IMAGENES=off` desactiva el hook.

## 6. Ajustes manuales que debes hacer

1. **`.env`**: `GEMINI_API_KEY` y, si quieres URLs públicas, todas las `S3_*`.
2. **Confianza del proyecto**: abre `claude` una vez en `popmaker-local/` y acepta el diálogo.
   Hasta entonces Claude Code ignora `.claude/settings.json` (permisos y **hook**) y el MCP
   queda "Pending approval".
3. **Cargar `.env` antes de `claude`** (`set -a; source .env; set +a`). Claude Code no lee `.env`:
   el MCP recibe las claves del entorno de tu terminal. Sin `GEMINI_API_KEY` el servidor
   no arranca ("Failed to connect"). `run_workflow.sh` ya lo hace solo.
4. **Placeholders** (`[ASÍ]`):
   - `.claude/skills/estilo-visual/SKILL.md`: paleta, tipo de imagen, referencias y **prompt base**.
   - `.claude/skills/voz-marca/SKILL.md`: tono y ejemplos reales "así sí / así no".
   - `config/brand_voice.yaml`: marca, audiencia, tono, CTA, palabras prohibidas, hashtags.
   - `config/plataformas.yaml`: revisa longitudes y dimensiones; borra las plataformas que no uses.
5. **Material de referencia**: deja en `data/referencias/` posts, textos o imágenes que te gusten.
6. **cron/launchd**: usa rutas absolutas y comprueba que `claude`, `npx` y `python3` están en el
   PATH que añade `run_workflow.sh` (edita la línea `export PATH=` si los tienes en otro sitio).

## 7. Ejecución desatendida

```bash
scripts/run_workflow.sh --tema "productividad" --plataforma instagram --cantidad 2
scripts/run_workflow.sh --tema "productividad" --dry-run
scripts/run_workflow.sh --tema "productividad" --sin-claude   # ideas con Gemini + imágenes pendientes
scripts/run_workflow.sh --solo-imagen                         # solo imágenes pendientes
```

Deja un registro en `data/logs/`. Ejemplo de **cron** (L-V a las 8:00):

```cron
0 8 * * 1-5 /Users/tu-usuario/popmaker-local/scripts/run_workflow.sh --tema "productividad" --plataforma linkedin
```

Ejemplo de **launchd** (macOS), `~/Library/LaunchAgents/com.popmaker.diario.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.popmaker.diario</string>
  <key>ProgramArguments</key><array>
    <string>/Users/tu-usuario/popmaker-local/scripts/run_workflow.sh</string>
    <string>--tema</string><string>productividad</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>
</dict></plist>
```

Actívalo con `launchctl load ~/Library/LaunchAgents/com.popmaker.diario.plist`.

## 8. Si el MCP no está disponible

`scripts/generate_images.py` usa `--via auto` por defecto: primero el MCP y, si falla
(sin Node.js, error de configuración…), la API de Gemini directamente. La imagen se genera
igual, pero sin subir a S3. Para forzar una vía: `--via mcp` o `--via api`.

Para cambiar de servidor MCP, sustituye la entrada de `.mcp.json` y los nombres de
herramienta en `.claude/settings.json` y `scripts/generate_images.py`:

- **mcpimg** (OpenRouter, Together AI, Replicate, fal.ai; no sube a S3):
  `"command": "npx", "args": ["-y", "mcpimg"]`, con `OPENROUTER_API_KEY` ([openrouter.ai/keys](https://openrouter.ai/keys)),
  `TOGETHER_API_KEY`, `REPLICATE_API_TOKEN` o `FAL_KEY`.
- **@nuver-labs/image-gen-mcp** (Gemini y OpenAI; no sube a S3):
  `"command": "npx", "args": ["-y", "@nuver-labs/image-gen-mcp"]`, con `GEMINI_API_KEY` y/o
  `OPENAI_API_KEY` ([platform.openai.com/api-keys](https://platform.openai.com/api-keys)).

## 9. Archivos

| Archivo | Propósito |
| --- | --- |
| `.mcp.json` | Servidor MCP de imágenes. Va en la raíz del proyecto (Claude Code no lee `.claude/.mcp.json`). Las claves se leen del entorno. |
| `.claude/settings.json` | Permisos, MCP habilitado y hook `PostToolUse` con matcher `Write\|Edit` |
| `.claude/commands/generar-contenido.md` | El comando `/generar-contenido` |
| `.claude/hooks/on-write-generate-image.sh` | Tras escribir o editar un guion: valida el estilo y, si tiene `## Imagen sugerida`, genera la imagen y el `.txt` |
| `.claude/skills/estilo-visual/SKILL.md` | Paleta, tipo de imagen, referencias, prohibiciones y prompt base |
| `.claude/skills/voz-marca/SKILL.md` | Tono, estructura hook-desarrollo-CTA, ejemplos |
| `.claude/skills/generador-ideas/SKILL.md` | Proceso de ideas sin duplicados |
| `config/brand_voice.yaml` | Voz de marca en datos: tono, palabras prohibidas, longitud por plataforma |
| `config/plataformas.yaml` | YouTube, Instagram, LinkedIn y TikTok: formato, longitud, tipo, dimensiones |
| `config/prompts/*.md` | Plantillas de idea, guion e imagen |
| `scripts/comun.py` | Rutas, `.env`, YAML, llamada a Gemini y prompt base (compartido) |
| `scripts/generate_ideas.py` | Ideas sin Claude (Gemini), banco de ideas y duplicados |
| `scripts/generate_images.py` | Imagen de un guion: cliente MCP por stdio, o API de Gemini si falla |
| `scripts/validar_guion.py` | Comprueba un guion contra las reglas medibles de `brand_voice.yaml` (slides, palabras por slide, prohibidas) |
| `scripts/run_workflow.sh` | Encadenador para cron/launchd, con registro en `data/logs/` |
