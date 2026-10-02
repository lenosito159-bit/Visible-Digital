import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';

/** Error con mensaje pensado para mostrarse tal cual al tendero. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = 'ERROR',
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, code = 'DATOS_INVALIDOS', details?: unknown) =>
  new HttpError(400, msg, code, details);
export const forbidden = (msg = 'No tienes permiso para hacer esto.') => new HttpError(403, msg, 'SIN_PERMISO');
export const notFound = (msg = 'No se encontró.') => new HttpError(404, msg, 'NO_ENCONTRADO');
export const conflict = (msg: string, code = 'CONFLICTO') => new HttpError(409, msg, code);

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.length ? ` (${first.path.join('.')})` : '';
    throw badRequest(`Revisa los datos${where}: ${first?.message ?? 'falta completar algo'}`, 'DATOS_INVALIDOS', result.error.issues);
  }
  return result.data;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido.', code: 'JSON_INVALIDO' });
    return;
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'La foto es muy pesada (máximo 3 MB).', code: 'ARCHIVO_GRANDE' });
    return;
  }
  // Violación de unicidad en PostgreSQL.
  if (err?.code === '23505') {
    res.status(409).json({ error: 'Ya existe un registro con esos datos.', code: 'DUPLICADO', details: err.detail });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Algo falló en el servidor. Vuelve a intentar en un ratito.', code: 'ERROR_INTERNO' });
};
