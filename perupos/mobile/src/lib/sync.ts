import NetInfo from '@react-native-community/netinfo';
import { useSyncExternalStore } from 'react';
import type { AbonoInput, AbonoReceipt, BusinessSettings, Category, Customer, Permission, Product, Sale } from '@perupos/shared';
import { ApiError, OfflineError, api, currentSession, request } from './api';
import * as db from './db';

export interface SyncState {
  online: boolean;
  syncing: boolean;
  pending: number;
  failed: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

let state: SyncState = { online: true, syncing: false, pending: 0, failed: 0, lastSyncAt: null, lastError: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const syncState = () => state;

const dataListeners = new Set<() => void>();
/** Avisa a las pantallas que cambió el catálogo o los clientes (para recargar). */
export function onDataChanged(fn: () => void): () => void {
  dataListeners.add(fn);
  return () => {
    dataListeners.delete(fn);
  };
}
function emitDataChanged() {
  dataListeners.forEach((l) => l());
}

async function refreshCounts() {
  const counts = await db.countOutbox();
  setState({ pending: counts.pending, failed: counts.failed });
}

interface PushResult {
  kind: 'customer' | 'product' | 'sale' | 'abono';
  id: string | null;
  ok: boolean;
  permanent?: boolean;
  error?: string;
  data?: unknown;
}

async function push(): Promise<void> {
  const items = await db.listOutbox();
  const batch = {
    customers: items.filter((i) => i.kind === 'customer'),
    products: items.filter((i) => i.kind === 'product'),
    sales: items.filter((i) => i.kind === 'sale'),
    abonos: items.filter((i) => i.kind === 'abono'),
  };
  const total = batch.customers.length + batch.products.length + batch.sales.length + batch.abonos.length;
  if (total > 0) {
    const { results } = await request<{ results: PushResult[] }>('/sync/push', {
      method: 'POST',
      body: {
        customers: batch.customers.map((i) => i.payload),
        products: batch.products.map((i) => i.payload),
        sales: batch.sales.map((i) => i.payload),
        abonos: batch.abonos.map((i) => i.payload),
      },
      timeoutMs: 45_000,
    });
    for (const r of results) {
      const key = `${r.kind}:${r.id}`;
      if (r.ok) {
        await db.removeOutbox(key);
        if (r.kind === 'sale') await db.saveLocalSale(r.data as Sale, 'SYNCED');
      } else {
        await db.markOutboxError(key, r.error ?? 'Error', !!r.permanent);
        if (r.kind === 'sale' && r.permanent) {
          const local = await db.getLocalSale(r.id!);
          if (local) await db.saveLocalSale(local.sale, 'FAILED', r.error ?? null);
        }
      }
    }
  }

  // Fotos de productos creados en la caja (se suben después de crear el producto).
  for (const item of await db.listOutbox()) {
    if (item.kind !== 'productImage') continue;
    const { productId, uri } = item.payload as { productId: string; uri: string };
    const form = new FormData();
    form.append('image', { uri, name: 'foto.jpg', type: 'image/jpeg' } as unknown as Blob);
    try {
      await request(`/products/${productId}/image`, { method: 'POST', form, timeoutMs: 60_000 });
      await db.removeOutbox(item.id);
    } catch (err) {
      if (err instanceof OfflineError) throw err;
      const permanent = err instanceof ApiError && err.status < 500 && err.status !== 404;
      await db.markOutboxError(item.id, (err as Error).message, permanent || item.attempts > 5);
    }
  }
}

interface PullResponse {
  serverTime: string;
  settings: BusinessSettings;
  permissions: Permission[];
  categories: Category[];
  products: Product[];
  customers: Customer[];
  removedCustomerIds: string[];
}

async function pull(): Promise<void> {
  const since = await db.getKv<string>('lastPull');
  const data = await api.get<PullResponse>(`/sync/pull${since ? `?since=${encodeURIComponent(since)}` : ''}`);
  await db.setKv('settings', data.settings);
  await db.saveCategories(data.categories);
  await db.saveProducts(data.products);
  await db.saveCustomers(data.customers);
  await db.removeCustomers(data.removedCustomerIds);
  // Un minuto de margen por si una transacción terminó justo durante la descarga.
  await db.setKv('lastPull', new Date(new Date(data.serverTime).getTime() - 60_000).toISOString());
}

let running: Promise<void> | null = null;

/** Envía lo pendiente y baja lo nuevo. Seguro de llamar muchas veces. */
export function syncNow(): Promise<void> {
  if (!currentSession()) return Promise.resolve();
  running ??= (async () => {
    setState({ syncing: true });
    try {
      await push();
      await pull();
      await db.recomputePendingBalances();
      setState({ online: true, lastSyncAt: new Date().toISOString(), lastError: null });
      emitDataChanged();
    } catch (err) {
      if (err instanceof OfflineError) setState({ online: false });
      else setState({ lastError: (err as Error).message });
    } finally {
      await refreshCounts();
      setState({ syncing: false });
      running = null;
    }
  })();
  return running;
}

let started = false;

export function startSyncLoop(): void {
  if (started) return;
  started = true;
  NetInfo.addEventListener((info) => {
    const online = !!info.isConnected && info.isInternetReachable !== false;
    const cameBack = online && !state.online;
    setState({ online });
    if (cameBack) void syncNow();
  });
  setInterval(() => {
    if (state.online || state.pending > 0) void syncNow();
  }, 60_000);
  void refreshCounts();
}

// ---------- operaciones que funcionan sin internet ----------

/**
 * Registra la venta. Con internet va directo al servidor, así cualquier
 * problema (precio, límite de crédito) se ve en la pantalla de cobro. Sin
 * internet se guarda en el teléfono y se envía sola al volver la señal.
 */
export async function registerSale(payload: unknown, localSale: Sale): Promise<Sale> {
  if (state.online) {
    try {
      const sale = await api.post<Sale>('/sales', payload);
      await db.saveLocalSale(sale, 'SYNCED');
      await db.adjustLocalStock(sale.items.map((i) => ({ productId: i.productId, quantity: i.quantity })));
      void syncNow();
      return sale;
    } catch (err) {
      if (!(err instanceof OfflineError)) throw err;
      setState({ online: false });
    }
  }
  await db.saveLocalSale(localSale, 'PENDING');
  await db.enqueue('sale', localSale.id, payload);
  await db.adjustLocalStock(localSale.items.map((i) => ({ productId: i.productId, quantity: i.quantity })));
  await db.recomputePendingBalances();
  await refreshCounts();
  await syncNow();
  return (await db.getLocalSale(localSale.id))?.sale ?? localSale;
}

export async function registerAbono(
  payload: AbonoInput,
  optimistic: AbonoReceipt,
): Promise<AbonoReceipt> {
  // En línea se envía directo para devolver la constancia con el saldo exacto.
  if (state.online) {
    try {
      const receipt = await api.post<AbonoReceipt>('/abonos', payload);
      void syncNow();
      return receipt;
    } catch (err) {
      if (!(err instanceof OfflineError)) throw err;
      setState({ online: false });
    }
  }
  await db.enqueue('abono', payload.id, payload);
  await db.recomputePendingBalances();
  await refreshCounts();
  emitDataChanged();
  return optimistic;
}

export async function registerCustomer(payload: Record<string, unknown> & { id: string }, customer: Customer): Promise<void> {
  await db.insertLocalCustomer(customer);
  await db.enqueue('customer', payload.id, payload);
  await refreshCounts();
  emitDataChanged();
  void syncNow();
}

export async function registerProduct(
  payload: Record<string, unknown> & { id: string },
  product: Product,
  photoUri: string | null,
): Promise<void> {
  await db.saveProducts([{ ...product, imageUrl: photoUri }]);
  await db.enqueue('product', payload.id, payload);
  if (photoUri) await db.enqueue('productImage', payload.id, { productId: payload.id, uri: photoUri });
  await refreshCounts();
  emitDataChanged();
  void syncNow();
}
