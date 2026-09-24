// Plantilla para tu propia API. Se salta automáticamente hasta que definas
// API_BASE_URL en el archivo .env (o como secreto en GitHub Actions).
import { describe, expect, it } from 'vitest';
import { createClient } from '../src/api-client.js';

const { API_BASE_URL, API_TOKEN } = process.env;
const API_HEALTH_PATH = process.env.API_HEALTH_PATH || '/';

describe.skipIf(!API_BASE_URL)('Mi API', () => {
  const api = API_BASE_URL ? createClient({ baseUrl: API_BASE_URL, token: API_TOKEN }) : null;

  it(`GET ${API_HEALTH_PATH} responde sin errores`, async () => {
    const res = await api.get(API_HEALTH_PATH);

    expect(res.status).toBeLessThan(400);
  });

  // Añade aquí tus tests, por ejemplo:
  // it('GET /usuarios devuelve una lista', async () => {
  //   const res = await api.get('/usuarios');
  //   expect(res.status).toBe(200);
  //   expect(Array.isArray(res.data)).toBe(true);
  // });
});
