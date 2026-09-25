/**
 * Catálogo de APIs públicas generado a partir de
 * https://github.com/public-apis/public-apis (licencia MIT).
 */
import { readFileSync } from 'node:fs';

export const README_URL = 'https://raw.githubusercontent.com/public-apis/public-apis/master/README.md';
export const RUTA_CATALOGO = new URL('../catalogo/apis.json', import.meta.url);

const CABECERA_TABLA = /^\|?\s*API\s*\|\s*Description\s*\|\s*Auth\s*\|\s*HTTPS\s*\|\s*CORS\s*\|?\s*$/;
const ENLACE = /^\[(.+?)\]\((.+?)\)$/;

function normalizarAuth(valor) {
  const limpio = valor.replace(/[`\\]/g, '').trim();
  if (!limpio || /^no$/i.test(limpio)) return null;
  if (/pikey$/i.test(limpio)) return 'apiKey';
  return limpio;
}

function normalizarCors(valor) {
  const limpio = valor.replace(/`/g, '').trim().toLowerCase();
  return ['yes', 'no'].includes(limpio) ? limpio : 'unknown';
}

/** Convierte el README de public-apis en una lista de APIs. */
export function parsearReadme(markdown) {
  const apis = [];
  let categoria = null;
  let dentroDeTabla = false;

  for (const linea of markdown.split('\n')) {
    if (linea.startsWith('#')) {
      const titulo = linea.match(/^###\s+(.+?)\s*$/);
      categoria = titulo ? titulo[1] : null;
      dentroDeTabla = false;
      continue;
    }
    if (categoria && CABECERA_TABLA.test(linea)) {
      dentroDeTabla = true;
      continue;
    }
    if (!dentroDeTabla || !linea.startsWith('| [')) continue;

    const [nombreEnlace, descripcion, auth, https, cors] = linea.split('|').slice(1).map((c) => c.trim());
    const enlace = nombreEnlace.match(ENLACE);
    if (!enlace) continue;

    apis.push({
      nombre: enlace[1].trim(),
      descripcion,
      categoria,
      url: enlace[2].trim(),
      auth: normalizarAuth(auth ?? ''),
      https: /yes/i.test(https ?? ''),
      cors: normalizarCors(cors ?? ''),
    });
  }
  return apis;
}

/** Lee el catálogo guardado en catalogo/apis.json. */
export function cargarCatalogo(ruta = RUTA_CATALOGO) {
  return JSON.parse(readFileSync(ruta, 'utf8')).apis;
}

const normalizarTexto = (texto) =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Filtra APIs. Todos los filtros son opcionales:
 * - texto: busca en nombre, descripción y categoría
 * - categoria: parte del nombre de la categoría
 * - sinAuth: solo APIs que no necesitan clave
 * - soloHttps: solo APIs con HTTPS
 * - conCors: solo APIs con CORS (se pueden llamar desde el navegador)
 *
 * Con texto, los resultados se ordenan por relevancia: primero las que lo
 * tienen en el nombre, luego en la categoría y por último en la descripción.
 */
export function buscarApis(apis, { texto, categoria, sinAuth, soloHttps, conCors } = {}) {
  const palabras = texto ? normalizarTexto(texto).split(/\s+/).filter(Boolean) : [];
  const cat = categoria ? normalizarTexto(categoria) : null;

  const filtradas = apis.filter((api) => {
    if (sinAuth && api.auth !== null) return false;
    if (soloHttps && !api.https) return false;
    if (conCors && api.cors !== 'yes') return false;
    if (cat && !normalizarTexto(api.categoria).includes(cat)) return false;
    if (palabras.length) {
      const contenido = normalizarTexto(`${api.nombre} ${api.descripcion} ${api.categoria}`);
      return palabras.every((palabra) => contenido.includes(palabra));
    }
    return true;
  });
  if (!palabras.length) return filtradas;

  const relevancia = (api) => {
    const nombre = normalizarTexto(api.nombre);
    const categoriaApi = normalizarTexto(api.categoria);
    return palabras.reduce(
      (total, palabra) => total + (nombre.includes(palabra) ? 2 : 0) + (categoriaApi.includes(palabra) ? 1 : 0),
      0,
    );
  };
  return filtradas
    .map((api) => ({ api, puntos: relevancia(api) }))
    .sort((a, b) => b.puntos - a.puntos)
    .map(({ api }) => api);
}

/** Devuelve las categorías con su número de APIs, ordenadas por nombre. */
export function listarCategorias(apis) {
  const cuentas = new Map();
  for (const api of apis) {
    cuentas.set(api.categoria, (cuentas.get(api.categoria) ?? 0) + 1);
  }
  return [...cuentas].map(([nombre, total]) => ({ nombre, total })).sort((a, b) => a.nombre.localeCompare(b.nombre));
}
