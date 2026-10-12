import { Directory, File, Paths } from 'expo-file-system';
import {
  addCashMovement,
  adjustStock,
  closeCash,
  createCustomer,
  createProduct,
  currentCash,
  daySummary,
  getLedger,
  getSale,
  listLocalUsers,
  listSales,
  openCash,
  recentClosures,
  recordAbono,
  recordSale,
  stockHistory,
  unlock,
  updateCustomer,
  updateProduct,
  voidSale,
  type AbonoInput,
  type Actor,
  type CustomerInput,
  type CustomerPatch,
  type ProductInput,
  type ProductPatch,
  type SaleInput,
  type User,
} from '@perupos/shared';
import { localCrypto as c, localDb as db } from './localDb';
import { emitDataChanged } from './sync';

/**
 * Operaciones del negocio guardadas en este celular (sin servidor).
 * Cada una es todo o nada; las que crean algo usan un id fijo para que un
 * doble toque o un reintento no dupliquen.
 */
export const actorOf = (u: User): Actor => ({ id: u.id, name: u.name, role: u.role });

async function changed<T>(p: Promise<T>): Promise<T> {
  const out = await p;
  emitDataChanged();
  return out;
}

/** Copia la foto a la carpeta de la app (la de la cámara es temporal y el sistema la borra). */
export async function keepPhoto(uri: string, productId: string): Promise<string> {
  const dir = new Directory(Paths.document, 'fotos');
  dir.create({ idempotent: true, intermediates: true });
  const dest = new File(dir, `${productId}-${Date.now()}.jpg`);
  await new File(uri).copy(dest);
  return dest.uri;
}

export const store = {
  saveSale: async (input: SaleInput, user: User, authorizedBy?: string | null) =>
    (await changed(recordSale(db, c, input, actorOf(user), { authorizedBy }))).sale,
  getSale: (id: string) => getSale(db, id),
  listSales: (user: User) => listSales(db, { sellerId: user.role === 'ADMIN' ? undefined : user.id, limit: 200 }),
  voidSale: (user: User, id: string, reason: string) => changed(voidSale(db, c, actorOf(user), id, reason)),
  daySummary: (user: User) => daySummary(db, new Date(), user.role === 'ADMIN' ? undefined : user.id),

  saveAbono: (input: AbonoInput, user: User) => changed(recordAbono(db, c, input, actorOf(user))),
  newCustomer: (user: User, input: CustomerInput) => changed(createCustomer(db, c, actorOf(user), input)),
  editCustomer: (user: User, id: string, patch: CustomerPatch) => changed(updateCustomer(db, actorOf(user), id, patch)),
  ledger: (customerId: string) => getLedger(db, customerId),

  newProduct: (user: User, input: ProductInput) => changed(createProduct(db, c, actorOf(user), input)),
  editProduct: (user: User, id: string, patch: ProductPatch) => changed(updateProduct(db, actorOf(user), id, patch)),
  restock: (user: User, id: string, quantity: number) =>
    changed(adjustStock(db, c, actorOf(user), id, { kind: 'INGRESO', quantity })),
  countStock: (user: User, id: string, countedStock: number, note: string | null) =>
    changed(adjustStock(db, c, actorOf(user), id, { kind: 'AJUSTE', countedStock }, note)),
  stockHistory: (id: string) => stockHistory(db, id, 20),

  currentCash: () => currentCash(db),
  openCash: (user: User, openingCents: number) => changed(openCash(db, c, actorOf(user), openingCents)),
  cashMovement: (user: User, kind: 'IN' | 'OUT', amountCents: number, reason: string) =>
    changed(addCashMovement(db, c, actorOf(user), kind, amountCents, reason)),
  closeCash: (user: User, countedCents: number, transferredCents: number) =>
    changed(closeCash(db, actorOf(user), countedCents, transferredCents)),
  recentClosures: () => recentClosures(db, 10),

  /**
   * El dueño autoriza en el mismo celular con su PIN (descuento > 10 % o
   * fiado sobre el límite). Devuelve su id, o el mensaje de error.
   */
  async authorizeWithOwnerPin(pin: string): Promise<{ ok: true; ownerId: string; ownerName: string } | { ok: false; message: string }> {
    const owner = (await listLocalUsers(db)).find((u) => u.role === 'ADMIN');
    if (!owner) return { ok: false, message: 'No hay dueño registrado en este celular.' };
    const result = await unlock(db, c, owner.id, pin);
    return result.ok ? { ok: true, ownerId: owner.id, ownerName: owner.name } : { ok: false, message: result.message };
  },
};
