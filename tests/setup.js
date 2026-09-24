import { existsSync } from 'node:fs';

// Carga las variables de .env (API_BASE_URL, API_TOKEN...) si el archivo existe.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
