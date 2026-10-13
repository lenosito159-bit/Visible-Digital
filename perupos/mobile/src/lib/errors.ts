import { LocalError } from '@perupos/shared';

/** Mensaje amable para cualquier error. Los de la base del celular ya vienen escritos para el tendero. */
export function errorMessage(err: unknown): string {
  if (err instanceof LocalError) return err.message;
  return 'Algo falló. Vuelve a intentar.';
}
