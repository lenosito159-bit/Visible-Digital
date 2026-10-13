/** Aviso a las pantallas abiertas de que algo cambió en la base del celular (para recargar). */
const listeners = new Set<() => void>();

export function onDataChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitDataChanged(): void {
  listeners.forEach((l) => l());
}
