/** Fotos de productos: solo archivos del propio celular (la app no descarga nada de internet). */
export function imageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return /^(file:|content:|data:)/.test(path) ? path : null;
}
