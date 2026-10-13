import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { credentialsSummary, mask } from '../src/credentials.js';

describe('resumen de credenciales al arrancar', () => {
  it('nunca muestra una llave completa', () => {
    const secret = 'taypi_sk_test_9f8e7d6c5b4a3210';
    expect(mask(secret)).toBe('…3210');
    expect(mask(undefined)).toBe('falta');
    expect(mask('taypi_pk_test_xxxxxxxx')).toBe('es la de ejemplo del .env.example');
    const out = credentialsSummary({
      ...config,
      PAYMENTS_PROVIDER: 'taypi',
      TAYPI_PUBLIC_KEY: 'taypi_pk_test_1122334455667788',
      TAYPI_SECRET_KEY: secret,
      PSE_PROVIDER: 'nubefact',
      NUBEFACT_URL: 'https://api.nubefact.com/api/v1/ruta-secreta-123',
      NUBEFACT_TOKEN: 'tok_abcdefghijklmnop',
    }).join('\n');
    expect(out).toMatch(/^Credenciales cargadas/);
    expect(out).not.toContain(secret);
    expect(out).not.toContain('ruta-secreta-123');
    expect(out).not.toContain('tok_abcdefghijklmnop');
  });

  it('avisa si hay llaves pero se sigue en modo prueba', () => {
    const out = credentialsSummary({ ...config, PAYMENTS_PROVIDER: 'mock', TAYPI_SECRET_KEY: 'taypi_sk_test_9f8e7d6c5b4a3210' });
    expect(out[0]).toMatch(/^Sin credenciales reales en uso/);
    expect(out.join('\n')).toContain('PAYMENTS_PROVIDER=mock');
  });
});
