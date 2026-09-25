// Tests del catálogo de APIs públicas: no hacen llamadas de red.
import { describe, expect, it } from 'vitest';
import { buscarApis, cargarCatalogo, listarCategorias, parsearReadme } from '../src/catalogo.js';

const README_MINIMO = `
## Index
* [Animals](#animals)

### Animals
API | Description | Auth | HTTPS | CORS
|:---|:---|:---|:---|:---|
| [Cat Facts](https://catfact.ninja/ ) | Random cat facts | No | Yes | Yes |
| [Cats](https://docs.thecatapi.com/) | Pictures of cats | \`apiKey\` | Yes | No | |

### Weather
API | Description | Auth | HTTPS | CORS |
|:---|:---|:---|:---|:---|
| [Open-Meteo](https://open-meteo.com/) | Global weather forecast | No | Yes | Unknown |
| [Old Weather](http://old.example.com) | Legacy forecasts | \`OAuth\` | No | Unknown |

## License
`;

describe('parsearReadme', () => {
  const apis = parsearReadme(README_MINIMO);

  it('lee todas las filas de las tablas con su categoría', () => {
    expect(apis.map((api) => [api.nombre, api.categoria])).toEqual([
      ['Cat Facts', 'Animals'],
      ['Cats', 'Animals'],
      ['Open-Meteo', 'Weather'],
      ['Old Weather', 'Weather'],
    ]);
  });

  it('normaliza auth, HTTPS, CORS y la URL', () => {
    expect(apis[0]).toEqual({
      nombre: 'Cat Facts',
      descripcion: 'Random cat facts',
      categoria: 'Animals',
      url: 'https://catfact.ninja/',
      auth: null,
      https: true,
      cors: 'yes',
    });
    expect(apis[1]).toMatchObject({ auth: 'apiKey', cors: 'no' });
    expect(apis[3]).toMatchObject({ auth: 'OAuth', https: false, cors: 'unknown' });
  });
});

describe('buscarApis', () => {
  const apis = parsearReadme(README_MINIMO);

  it('busca texto sin distinguir mayúsculas', () => {
    expect(buscarApis(apis, { texto: 'CAT facts' }).map((a) => a.nombre)).toEqual(['Cat Facts']);
  });

  it('combina filtros', () => {
    const resultado = buscarApis(apis, { categoria: 'weather', sinAuth: true, soloHttps: true });
    expect(resultado.map((a) => a.nombre)).toEqual(['Open-Meteo']);
  });

  it('filtra por CORS', () => {
    expect(buscarApis(apis, { conCors: true }).map((a) => a.nombre)).toEqual(['Cat Facts']);
  });

  it('ordena por relevancia: nombre, luego categoría, luego descripción', () => {
    const lista = [
      { nombre: 'Aviation', descripcion: 'Airport weather', categoria: 'Transportation', auth: null, https: true, cors: 'yes' },
      { nombre: 'Open-Meteo', descripcion: 'Forecasts', categoria: 'Weather', auth: null, https: true, cors: 'yes' },
      { nombre: 'WeatherAPI', descripcion: 'Forecasts', categoria: 'Weather', auth: null, https: true, cors: 'yes' },
    ];
    expect(buscarApis(lista, { texto: 'weather' }).map((a) => a.nombre)).toEqual(['WeatherAPI', 'Open-Meteo', 'Aviation']);
  });
});

describe('catalogo/apis.json', () => {
  const apis = cargarCatalogo();

  it('contiene las APIs de public-apis con todos sus campos', () => {
    expect(apis.length).toBeGreaterThan(1000);
    for (const api of apis) {
      expect(api.nombre).toBeTruthy();
      expect(api.url).toMatch(/^https?:\/\/\S+$/);
      expect(typeof api.https).toBe('boolean');
      expect(['yes', 'no', 'unknown']).toContain(api.cors);
    }
  });

  it('tiene más de 40 categorías', () => {
    expect(listarCategorias(apis).length).toBeGreaterThan(40);
  });
});
