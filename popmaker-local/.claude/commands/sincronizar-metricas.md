---
description: Envía data/metricas.csv (con puntuación) a una hoja de Google Sheets
allowed-tools: Read, Edit, Bash(python3 scripts/metricas.py:*)
---

<!--
Decisión de diseño: el conector de Google Drive puede crear hojas pero no reescribir el
contenido de una existente, así que cada sincronización crea una hoja nueva con fecha.
Requiere el conector de Google Drive activado en tu cuenta de claude.ai.
-->

1. Ejecuta `python3 scripts/metricas.py exportar`. Si solo sale la cabecera, di que aún
   no hay métricas registradas y cómo registrarlas (`metricas.py registrar`), y para.
2. Con la herramienta `create_file` del conector de Google Drive, crea una hoja con título
   `PopMaker — Métricas YYYY-MM-DD` (fecha de hoy), `contentMimeType: text/csv` y como
   `textContent` la salida exacta del paso 1. Si el conector no está disponible, dilo y para.
3. Guarda la URL de la hoja en `config/integraciones.yaml` → `google_drive.ultima_sincronizacion`.
4. Resume: número de piezas, ingresos totales y las 3 primeras del ranking, con el enlace.
