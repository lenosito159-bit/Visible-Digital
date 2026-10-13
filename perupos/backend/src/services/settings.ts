import type { BusinessSettings } from '@perupos/shared';
import { one, type Db } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { toSettings } from './mappers.js';

export async function getSettings(db: Db): Promise<BusinessSettings> {
  const row = await one(db, 'SELECT * FROM business_settings WHERE id = 1');
  if (!row) {
    throw new HttpError(503, 'Falta configurar los datos del negocio (RUC). Ejecuta el seed.', 'SIN_CONFIGURAR');
  }
  return toSettings(row);
}
