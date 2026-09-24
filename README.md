# API Testing

Proyecto para testear APIs de forma automática con [Vitest](https://vitest.dev) y
validación de respuestas con [Zod](https://zod.dev).

## Requisitos

- Node.js 22.12 o superior

## Puesta en marcha

```bash
npm install
npm test
```

Los tests de ejemplo (`tests/ejemplos/`) usan [JSONPlaceholder](https://jsonplaceholder.typicode.com),
una API pública de pruebas, así que funcionan sin configurar nada.

## Testear tu propia API

1. Copia `.env.example` como `.env` y rellena los datos:

   ```bash
   API_BASE_URL=https://api.tu-dominio.com
   API_TOKEN=tu-token        # opcional
   API_HEALTH_PATH=/health   # ruta para el test básico
   ```

2. Ejecuta `npm test`. El test de `tests/mi-api.test.js` se activa solo cuando
   `API_BASE_URL` tiene valor.
3. Añade tus tests en `tests/`, en archivos que terminen en `.test.js`, siguiendo el
   ejemplo de `tests/ejemplos/jsonplaceholder.test.js`.

El archivo `.env` no se sube a GitHub, así que tus tokens quedan en tu máquina.

## Cliente HTTP

`src/api-client.js` simplifica las peticiones:

```js
import { createClient } from '../src/api-client.js';

const api = createClient({ baseUrl: 'https://api.ejemplo.com', token: 'opcional' });

const res = await api.get('/usuarios', { query: { page: 1 } });
res.status;     // 200
res.data;       // cuerpo ya convertido de JSON
res.headers;    // cabeceras de la respuesta
res.durationMs; // tiempo de respuesta en milisegundos

await api.post('/usuarios', { nombre: 'Ana' });
await api.put('/usuarios/1', { nombre: 'Ana' });
await api.patch('/usuarios/1', { nombre: 'Ana' });
await api.delete('/usuarios/1');
```

Las respuestas 4xx y 5xx no lanzan error, así que también puedes comprobar
que la API rechaza lo que debe rechazar.

## Comandos

| Comando               | Qué hace                                              |
| --------------------- | ----------------------------------------------------- |
| `npm test`            | Ejecuta todos los tests una vez                       |
| `npm run test:watch`  | Vuelve a ejecutar los tests al guardar cambios        |
| `npm run test:report` | Ejecuta los tests y genera `reports/junit.xml`        |

## Integración continua (GitHub Actions)

El workflow `.github/workflows/api-tests.yml` ejecuta los tests en cada push, en
cada pull request, a mano desde la pestaña *Actions* y todos los días a las 07:00 UTC.

Para que también pruebe tu API, añade en *Settings → Secrets and variables → Actions*:

- Secretos: `API_BASE_URL` y, si hace falta, `API_TOKEN`
- Variable (opcional): `API_HEALTH_PATH`
