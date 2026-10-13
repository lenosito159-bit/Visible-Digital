import { useSyncExternalStore } from 'react';
import { lineTotal, type Product } from '@perupos/shared';

export interface CartLine {
  product: Product;
  quantity: number;
}

interface CartState {
  lines: CartLine[];
}

let state: CartState = { lines: [] };
const listeners = new Set<() => void>();

function set(next: CartState) {
  state = next;
  listeners.forEach((l) => l());
}

/** Carrito de la venta en curso (uno por teléfono). */
export const cart = {
  add(product: Product, quantity = 1) {
    const existing = state.lines.find((l) => l.product.id === product.id);
    if (existing) {
      set({
        lines: state.lines.map((l) => (l.product.id === product.id ? { ...l, quantity: round(l.quantity + quantity) } : l)),
      });
    } else {
      // Lo último escaneado va arriba: es lo que el vendedor está mirando.
      set({ lines: [{ product, quantity }, ...state.lines] });
    }
  },
  setQuantity(productId: string, quantity: number) {
    if (quantity <= 0) return cart.remove(productId);
    set({ lines: state.lines.map((l) => (l.product.id === productId ? { ...l, quantity: round(quantity) } : l)) });
  },
  remove(productId: string) {
    set({ lines: state.lines.filter((l) => l.product.id !== productId) });
  },
  clear() {
    set({ lines: [] });
  },
  get: () => state,
};

function round(q: number) {
  return Math.round(q * 1000) / 1000;
}

export function cartTotals(lines: CartLine[]) {
  const subtotalCents = lines.reduce((sum, l) => sum + lineTotal(l.product.priceCents, l.quantity), 0);
  const count = lines.reduce((sum, l) => sum + (l.product.unit === 'KG' ? 1 : l.quantity), 0);
  return { subtotalCents, count };
}

export function useCart(): CartState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
