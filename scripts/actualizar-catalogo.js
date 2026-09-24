// Regenera catalogo/apis.json a partir del README de public-apis.
//
// Uso:
//   npm run catalogo:actualizar                   # descarga la última versión de GitHub
//   npm run catalogo:actualizar -- ruta/README.md # usa un README local
import { readFileSync, writeFileSync } from 'node:fs';
import { README_URL, RUTA_CATALOGO, parsearReadme } from '../src/catalogo.js';

const rutaLocal = process.argv[2];
let markdown;
if (rutaLocal) {
  markdown = readFileSync(rutaLocal, 'utf8');
} else {
  const respuesta = await fetch(README_URL, { signal: AbortSignal.timeout(30_000) });
  if (!respuesta.ok) {
    throw new Error(`No se pudo descargar ${README_URL}: HTTP ${respuesta.status}`);
  }
  markdown = await respuesta.text();
}

const apis = parsearReadme(markdown);
if (apis.length < 1000) {
  throw new Error(`Solo se encontraron ${apis.length} APIs: el formato del README puede haber cambiado.`);
}

const catalogo = {
  fuente: 'https://github.com/public-apis/public-apis',
  licencia: 'MIT, Copyright (c) 2022 public-apis (ver catalogo/LICENSE-public-apis)',
  actualizado: new Date().toISOString().slice(0, 10),
  total: apis.length,
  apis,
};
writeFileSync(RUTA_CATALOGO, `${JSON.stringify(catalogo, null, 2)}\n`);
console.log(`Catálogo actualizado: ${apis.length} APIs en ${new Set(apis.map((a) => a.categoria)).size} categorías.`);
