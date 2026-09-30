import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().default('postgres://perupos:perupos@localhost:5432/perupos'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  CORS_ORIGIN: z.string().default('*'),
  UPLOAD_DIR: z.string().default('uploads'),

  // Pagos con QR interoperable (Yape / Plin).
  PAYMENTS_PROVIDER: z.enum(['mock', 'taypi']).default('mock'),
  TAYPI_PUBLIC_KEY: z.string().optional(),
  TAYPI_SECRET_KEY: z.string().optional(),
  TAYPI_WEBHOOK_SECRET: z.string().optional(),
  TAYPI_BASE_URL: z
    .enum(['https://app.taypi.pe', 'https://sandbox.taypi.pe', 'https://dev.taypi.pe'])
    .default('https://sandbox.taypi.pe'),
  QR_TTL_SECONDS: z.coerce.number().int().min(30).default(120),
  /** Solo proveedor mock: marca el QR como pagado tras N segundos (0 = nunca). */
  MOCK_AUTOPAY_SECONDS: z.coerce.number().int().min(0).default(0),

  // Comprobantes electrónicos (PSE).
  PSE_PROVIDER: z.enum(['mock', 'nubefact', 'none']).default('mock'),
  NUBEFACT_URL: z.string().url().optional(),
  NUBEFACT_TOKEN: z.string().optional(),

  PUSH_ENABLED: bool.default(true),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  JOBS_ENABLED: bool.default(true),
  ALERTS_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(15),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida (revisa tu .env):\n${detail}`);
  }
  const cfg = parsed.data;
  if (cfg.PAYMENTS_PROVIDER === 'taypi' && !(cfg.TAYPI_PUBLIC_KEY && cfg.TAYPI_SECRET_KEY)) {
    throw new Error('PAYMENTS_PROVIDER=taypi necesita TAYPI_PUBLIC_KEY y TAYPI_SECRET_KEY');
  }
  if (cfg.PSE_PROVIDER === 'nubefact' && !(cfg.NUBEFACT_URL && cfg.NUBEFACT_TOKEN)) {
    throw new Error('PSE_PROVIDER=nubefact necesita NUBEFACT_URL y NUBEFACT_TOKEN');
  }
  return cfg;
}

export const config = load();
