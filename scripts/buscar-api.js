// Busca APIs en el catálogo de public-apis.
//
// Ejemplos:
//   npm run buscar -- weather --sin-auth
//   npm run buscar -- --categoria games --sin-auth --https
//   npm run buscar -- --categorias
import { parseArgs } from 'node:util';
import { buscarApis, cargarCatalogo, listarCategorias } from '../src/catalogo.js';

const AYUDA = `Uso: npm run buscar -- [texto] [opciones]

  texto               Palabras a buscar en nombre, descripción o categoría (en inglés)
  --categoria <c>     Filtra por categoría (ej.: weather, games, finance)
  --sin-auth          Solo APIs que no necesitan clave
  --https             Solo APIs con HTTPS
  --cors              Solo APIs que se pueden llamar desde el navegador
  --limite <n>        Máximo de resultados (por defecto 30, 0 = todos)
  --json              Muestra el resultado en JSON
  --categorias        Lista las categorías disponibles
  --ayuda             Muestra esta ayuda`;

const OPCIONES = {
  categoria: { type: 'string' },
  'sin-auth': { type: 'boolean' },
  https: { type: 'boolean' },
  cors: { type: 'boolean' },
  limite: { type: 'string', default: '30' },
  json: { type: 'boolean' },
  categorias: { type: 'boolean' },
  ayuda: { type: 'boolean' },
};

function fallar(mensaje) {
  console.error(`Error: ${mensaje}\nUsa "npm run buscar -- --ayuda" para ver las opciones.`);
  process.exit(1);
}

function explicarError(error) {
  const opcion = error.message.match(/'(-[^' ]+)/)?.[1] ?? '';
  if (error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
    const sinGuiones = (texto) => texto.replace(/-/g, '');
    const parecida = Object.keys(OPCIONES).find((nombre) => sinGuiones(nombre) === sinGuiones(opcion));
    return `opción desconocida ${opcion}${parecida ? `. ¿Quisiste decir --${parecida}?` : ''}`;
  }
  if (error.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
    return error.message.includes('argument missing') ? `falta el valor de ${opcion}` : `${opcion} no admite valor`;
  }
  return error.message;
}

let values;
let positionals;
try {
  ({ values, positionals } = parseArgs({ allowPositionals: true, options: OPCIONES }));
} catch (error) {
  fallar(explicarError(error));
}

if (!/^\d+$/.test(values.limite)) {
  fallar('--limite debe ser un número entero (0 = todos)');
}

if (values.ayuda) {
  console.log(AYUDA);
  process.exit(0);
}

const apis = cargarCatalogo();

if (values.categorias) {
  for (const { nombre, total } of listarCategorias(apis)) {
    console.log(`${String(total).padStart(4)}  ${nombre}`);
  }
  process.exit(0);
}

const resultados = buscarApis(apis, {
  texto: positionals.join(' '),
  categoria: values.categoria,
  sinAuth: values['sin-auth'],
  soloHttps: values.https,
  conCors: values.cors,
});
const limite = Number(values.limite);
const mostrados = limite > 0 ? resultados.slice(0, limite) : resultados;

if (values.json) {
  console.log(JSON.stringify(mostrados, null, 2));
  process.exit(0);
}

if (!resultados.length) {
  console.log('No se encontraron APIs. Prueba con otras palabras (en inglés) o menos filtros.');
  process.exit(0);
}

for (const api of mostrados) {
  const etiquetas = [
    api.auth ? `auth: ${api.auth}` : 'sin auth',
    api.https ? 'HTTPS' : 'sin HTTPS',
    `CORS: ${{ yes: 'sí', no: 'no', unknown: '?' }[api.cors]}`,
  ].join(' · ');
  console.log(`${api.nombre}  [${api.categoria}]`);
  console.log(`  ${api.descripcion}`);
  console.log(`  ${api.url}`);
  console.log(`  ${etiquetas}\n`);
}
console.log(
  mostrados.length < resultados.length
    ? `Mostrando ${mostrados.length} de ${resultados.length} APIs (usa --limite 0 para verlas todas).`
    : `${resultados.length} APIs encontradas.`,
);
