/**
 * Cliente HTTP mínimo para tests de APIs.
 *
 * Cada petición devuelve { status, headers, data, durationMs } y nunca lanza
 * por códigos 4xx/5xx, para que los tests puedan comprobar errores también.
 */
export function createClient({ baseUrl, token, headers = {}, timeoutMs = 10_000 } = {}) {
  if (!baseUrl) {
    throw new Error('createClient: falta "baseUrl"');
  }
  const root = baseUrl.replace(/\/+$/, '');

  async function request(method, path, { body, query, headers: extraHeaders } = {}) {
    const url = new URL(root + (path.startsWith('/') ? path : `/${path}`));
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.append(key, String(value));
    }

    const finalHeaders = {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
      ...extraHeaders,
    };

    const start = performance.now();
    const response = await fetch(url, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    const durationMs = performance.now() - start;

    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    return { status: response.status, headers: response.headers, data, durationMs };
  }

  return {
    get: (path, options) => request('GET', path, options),
    post: (path, body, options) => request('POST', path, { ...options, body }),
    put: (path, body, options) => request('PUT', path, { ...options, body }),
    patch: (path, body, options) => request('PATCH', path, { ...options, body }),
    delete: (path, options) => request('DELETE', path, options),
  };
}
