# PopMaker local

Pipeline de contenido (ideas → guiones → imágenes) que se ejecuta en tu máquina con
Claude Code. Claude hace de orquestador; las skills fijan tu voz y tu estilo visual, y
un servidor MCP genera las imágenes con Gemini (Nano Banana).

```
/generar-contenido "tema"
   │
   ├─ 1. skill generador-ideas ─ scripts/generate_ideas.py ─▶ data/ideas/YYYY-MM-DD_ideas.md
   ├─ 2. elige las mejores ideas
   ├─ 3. skill voz-marca + estilo-visual ──────────────────▶ data/output/YYYY-MM-DD_<slug>.md
   │                                                         (texto + bloques image-prompt)
   └─ 4. hook PostToolUse (on-write-generate-image.sh)
          ├─ modo mcp:    Claude llama a mcp-media-toolkit ─▶ data/output/imagenes/<slug>/
          └─ modo script: scripts/generate_images.py ──────▶ data/output/imagenes/<slug>/
                                                            (+ subida a S3/R2 si está configurado)
```

## Requisitos

- [Claude Code](https://code.claude.com) (`npm install -g @anthropic-ai/claude-code`)
- Node.js 18+ (para `npx mcp-media-toolkit`)
- Python 3.9+ (solo biblioteca estándar; `pip install boto3` si quieres subir a S3 desde el modo `script`)
- Una API key de Gemini (ver abajo)

## Puesta en marcha

```bash
cd popmaker-local
cp .env.example .env          # rellena GEMINI_API_KEY (y S3_* si quieres URLs públicas)
set -a; source .env; set +a   # Claude Code pasa estas variables al servidor MCP
claude                        # la primera vez, aprueba el servidor mcp-media-toolkit
```

Dentro de Claude Code:

```
/mcp                                              # comprueba que mcp-media-toolkit está conectado
/generar-contenido productividad para freelancers
/generar-contenido batch cooking --n 8 --plataforma tiktok --guiones 2
/generar-contenido marca personal --sin-imagenes
```

Sin abrir la interfaz (útil para cron o CI):

```bash
./scripts/run_workflow.sh "productividad para freelancers" -n 5 -p instagram -g 1
./scripts/run_workflow.sh "batch cooking" --modo script   # imágenes por API directa, sin MCP
```

Abre Claude Code **dentro de `popmaker-local/`**: las skills, el comando, el hook y
`.mcp.json` se cargan desde el directorio del proyecto.

## Personalización (hazlo antes de la primera ejecución)

| Archivo | Qué rellenar |
| --- | --- |
| `.claude/skills/voz-marca/SKILL.md` | Tono, audiencia, palabras prohibidas y, sobre todo, ejemplos reales de tu marca |
| `.claude/skills/estilo-visual/SKILL.md` | Paleta, tipo de imagen, referencias y el **prompt base** |
| `config/brand_voice.yaml` | Datos de marca, CTA, hashtags y parámetros del pipeline (N ideas, calidad de imagen) |
| `config/plataformas.yaml` | Plataformas activas, longitudes y `aspect_ratio` |
| `config/prompts/*.md` | Plantillas de ideas, guion e imagen |
| `data/referencias/` | Posts, capturas o textos que te gusten: el generador de ideas los consulta |

Los valores pendientes van entre corchetes (`[COLOR_PRIMARIO]`). Mientras el prompt
base tenga placeholders, el pipeline te avisa en el resumen.

## Cómo funciona cada pieza

### Skills (`.claude/skills/`)

- **generador-ideas**: analiza el tema, revisa `data/ideas/` y guarda N ideas nuevas con
  título, ángulo, plataforma, formato, hook y justificación.
- **voz-marca**: tono, estructura hook → desarrollo → CTA, longitudes y checklist.
- **estilo-visual**: reglas de imagen y el prompt base que se añade a cada imagen.

Claude las usa solas cuando la tarea encaja, también fuera de `/generar-contenido`
(por ejemplo: "reescribe este post con nuestra voz").

### Banco de ideas (`scripts/generate_ideas.py`)

```bash
python3 scripts/generate_ideas.py contexto --tema "portfolio"   # banco + referencias
python3 scripts/generate_ideas.py guardar --tema "portfolio" --archivo nuevas.md
python3 scripts/generate_ideas.py listar --dias 30
```

`guardar` asigna IDs (`20260924-03`) y descarta las ideas cuyo título o ángulo se
parece demasiado a uno existente (usa `--forzar` para guardarlas igualmente).

### Guiones (`data/output/`)

Cada guion es un Markdown con frontmatter (`plataforma`, `aspect_ratio`, `idea_id`…),
el texto y bloques ` ```image-prompt ` con solo la escena. El estilo se añade al
generar, así que si cambias el prompt base puedes regenerar sin tocar los guiones.

### Hook (`.claude/hooks/on-write-generate-image.sh`)

Se ejecuta tras cada `Write`/`Edit`. Si el archivo es un guion de `data/output/` con
bloques `image-prompt` y aún no tiene la marca `<!-- imagenes-generadas -->`:

| `POPMAKER_IMAGE_MODE` | Qué hace |
| --- | --- |
| `mcp` (defecto) | Devuelve a Claude los prompts completos; Claude llama a `generate_image_gemini` (o `generate_and_upload_gemini_s3` si S3 está configurado) y anota el guion |
| `script` | Genera las imágenes con `scripts/generate_images.py` y le pasa el resultado a Claude |
| `off` | Nada |

Para regenerar las imágenes de un guion, borra su sección "Imágenes generadas" o ejecuta:

```bash
python3 scripts/generate_images.py generar data/output/<guion>.md --dry-run   # ver prompts
python3 scripts/generate_images.py generar --todos                             # todos los pendientes
```

### Calidad de imagen

`pipeline.calidad_imagen` en `config/brand_voice.yaml`:

| Valor | Modelo | Resolución |
| --- | --- | --- |
| `fast` | `gemini-2.5-flash-image` (Nano Banana) | 1K |
| `balanced` | `gemini-3.1-flash-image-preview` (Nano Banana 2) | 2K |
| `quality` | `gemini-3-pro-image-preview` (Nano Banana Pro) | 4K, lento |

## Cómo conseguir cada clave

### `GEMINI_API_KEY` (obligatoria)

1. Entra en [Google AI Studio → API keys](https://aistudio.google.com/apikey) con tu cuenta de Google.
2. Pulsa **Create API key** y elige (o crea) un proyecto de Google Cloud.
3. Copia la clave (`AIza…`) en `.env`.

La generación de imágenes puede requerir tener la facturación activada en el proyecto;
revisa precios y cuotas en [ai.google.dev/pricing](https://ai.google.dev/pricing).

### Almacenamiento S3 (opcional, para obtener URLs públicas)

Sin estas variables, las imágenes se guardan solo en `data/output/imagenes/`. Si
defines una, hay que definir todas (`S3_ENDPOINT`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_PUBLIC_URL`); `S3_REGION` es opcional.

**Cloudflare R2** (recomendado: sin coste por descarga)

1. Panel de Cloudflare → **R2 Object Storage** → **Create bucket** (ej.: `media`) → `S3_BUCKET`.
2. En la página de R2, copia tu **Account ID**: `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
3. **Manage R2 API Tokens** → **Create API token** con permiso *Object Read & Write* sobre ese bucket.
   Te da `S3_ACCESS_KEY_ID` y `S3_SECRET_ACCESS_KEY` (solo se muestran una vez).
4. En el bucket → **Settings** → **Public access**: conecta un dominio propio
   (`S3_PUBLIC_URL=https://media.tudominio.com`) o activa el subdominio `r2.dev`
   (`https://pub-<hash>.r2.dev`).
5. `S3_REGION=auto`.

**AWS S3**

1. Consola de S3 → **Create bucket** y anota la región (ej.: `eu-west-1`).
2. Permite lectura pública con una bucket policy de `s3:GetObject` (o sirve el bucket con CloudFront).
3. IAM → **Users** → crea un usuario con una política que permita `s3:PutObject` en el bucket →
   **Security credentials** → **Create access key**.
4. `S3_ENDPOINT=https://s3.<region>.amazonaws.com`,
   `S3_PUBLIC_URL=https://<bucket>.s3.<region>.amazonaws.com`, `S3_REGION=<region>`.

**MinIO** (autoalojado, todo local)

1. `docker run -p 9000:9000 -p 9001:9001 minio/minio server /data --console-address ":9001"`
2. En la consola (`http://localhost:9001`) crea el bucket, ponle acceso anónimo de lectura y
   crea una access key en **Access Keys**.
3. `S3_ENDPOINT=http://localhost:9000`, `S3_PUBLIC_URL=http://localhost:9000/<bucket>`, `S3_REGION=us-east-1`.

## Servidores MCP alternativos

`mcp-media-toolkit` es el elegido porque genera con Gemini y sube a S3 en una sola
llamada. Si prefieres otro proveedor, sustituye la entrada en `.mcp.json` y actualiza
los nombres de herramienta en `.claude/settings.json`, en `.claude/commands/generar-contenido.md`
y en el hook (modo `mcp`). El modo `script` no depende del servidor MCP.

**mcpimg** (OpenRouter, Together AI, Replicate, fal.ai; no sube a S3):

```json
"image-gen": {
  "command": "npx",
  "args": ["-y", "mcpimg"],
  "env": {
    "OPENROUTER_API_KEY": "${OPENROUTER_API_KEY:-}",
    "TOGETHER_API_KEY": "${TOGETHER_API_KEY:-}",
    "REPLICATE_API_TOKEN": "${REPLICATE_API_TOKEN:-}",
    "FAL_KEY": "${FAL_KEY:-}",
    "IMAGE_OUTPUT_DIR": "data/output/imagenes"
  }
}
```

Claves: [openrouter.ai/keys](https://openrouter.ai/keys), [api.together.ai/settings/api-keys](https://api.together.ai/settings/api-keys),
[replicate.com/account/api-tokens](https://replicate.com/account/api-tokens), [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys).

**@nuver-labs/image-gen-mcp** (Gemini y OpenAI, genera y edita; no sube a S3):

```json
"image-gen": {
  "command": "npx",
  "args": ["-y", "@nuver-labs/image-gen-mcp"],
  "env": {
    "GEMINI_API_KEY": "${GEMINI_API_KEY:-}",
    "OPENAI_API_KEY": "${OPENAI_API_KEY:-}"
  },
  "timeout": 600000
}
```

Clave de OpenAI: [platform.openai.com/api-keys](https://platform.openai.com/api-keys).

## Estructura

```
popmaker-local/
├── .mcp.json                  # servidor MCP de imágenes (Claude Code lo lee de la raíz del proyecto)
├── .env.example               # claves (cópialo a .env)
├── .claude/
│   ├── settings.json          # permisos, servidor MCP habilitado y hook PostToolUse
│   ├── commands/generar-contenido.md
│   ├── hooks/on-write-generate-image.sh
│   └── skills/{estilo-visual,voz-marca,generador-ideas}/SKILL.md
├── config/
│   ├── brand_voice.yaml
│   ├── plataformas.yaml
│   └── prompts/{idea,script,image}_prompt.md
├── data/
│   ├── referencias/           # tu material de referencia
│   ├── ideas/                 # banco de ideas por día
│   └── output/                # guiones; imagenes/<slug>/ con las imágenes
└── scripts/
    ├── generate_ideas.py
    ├── generate_images.py
    └── run_workflow.sh
```

## Problemas frecuentes

- **`/mcp` no muestra el servidor**: abre Claude Code desde `popmaker-local/` y comprueba
  que exportaste las variables antes de lanzarlo (`echo $GEMINI_API_KEY`).
- **"S3 upload requires all of…"**: definiste solo parte de las variables `S3_*`; rellénalas
  todas o vacíalas todas.
- **El hook no hace nada**: el guion debe estar directamente en `data/output/`, tener bloques
  ` ```image-prompt ` y no tener ya la marca `<!-- imagenes-generadas -->`. Revisa también
  que `POPMAKER_IMAGE_MODE` no sea `off` y que el script sea ejecutable
  (`chmod +x .claude/hooks/on-write-generate-image.sh`).
- **Imágenes sin tu estilo**: rellena el prompt base de `estilo-visual`.
