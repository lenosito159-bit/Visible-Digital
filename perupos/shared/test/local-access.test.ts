import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOCAL_SCHEMA_VERSION,
  LocalError,
  addHelper,
  businessSettings,
  changePin,
  getBusiness,
  listLocalUsers,
  migrateLocal,
  removeHelper,
  resetOwnerPin,
  setupBusiness,
  unlock,
  updateBusiness,
} from '../src/local/index.js';
import { nodeCrypto, nodeLocalDb } from './node-local-db.js';

const c = nodeCrypto;
let db: ReturnType<typeof nodeLocalDb>;

beforeEach(async () => {
  db = nodeLocalDb();
  await migrateLocal(db);
});
afterEach(() => db.close());

const doñaRosa = { businessName: 'Bodega Doña Rosa', ownerName: 'Rosa', pin: '2580' };

describe('base local', () => {
  it('crea las tablas y no se rompe si se migra dos veces', async () => {
    expect(await migrateLocal(db)).toBe(LOCAL_SCHEMA_VERSION);
    const tables = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(['business', 'local_users']));
  });

  it('no abre datos de una versión más nueva de la app', async () => {
    await db.exec(`PRAGMA user_version = ${LOCAL_SCHEMA_VERSION + 1}`);
    await expect(migrateLocal(db)).rejects.toThrow(/versión más nueva/);
  });

  it('los datos siguen ahí al cerrar y volver a abrir la app', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'perupos-'));
    try {
      const file = join(dir, 'perupos.db');
      const first = nodeLocalDb(file);
      await migrateLocal(first);
      await setupBusiness(first, c, doñaRosa);
      first.close();
      const again = nodeLocalDb(file);
      await migrateLocal(again);
      expect((await getBusiness(again))?.name).toBe('Bodega Doña Rosa');
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('primera configuración, sin RUC ni servidor', () => {
  it('solo pide nombre del negocio, tu nombre y PIN', async () => {
    const { business, owner, recoveryCode } = await setupBusiness(db, c, doñaRosa);
    expect(business).toMatchObject({ name: 'Bodega Doña Rosa', ownerName: 'Rosa', phone: null });
    expect(owner).toMatchObject({ name: 'Rosa', role: 'ADMIN' });
    expect(recoveryCode).toMatch(/^\d{10}$/);
    const settings = businessSettings(business);
    expect(settings.ruc).toBe('');
    expect(settings.razonSocial).toBe('');
    expect(settings.nombreComercial).toBe('Bodega Doña Rosa');
  });

  it('el celular es opcional, pero si se pone debe ser un celular peruano', async () => {
    await expect(setupBusiness(db, c, { ...doñaRosa, phone: '12345' })).rejects.toThrow(/9 números/);
    const { business } = await setupBusiness(db, c, { ...doñaRosa, phone: '+51 987 654 321' });
    expect(business.phone).toBe('987654321');
  });

  it('valida PIN y nombres con mensajes claros', async () => {
    await expect(setupBusiness(db, c, { ...doñaRosa, pin: '12' })).rejects.toThrow('de 4 a 6 números');
    await expect(setupBusiness(db, c, { ...doñaRosa, pin: '12ab' })).rejects.toThrow('de 4 a 6 números');
    await expect(setupBusiness(db, c, { ...doñaRosa, businessName: ' ' })).rejects.toThrow('nombre del negocio');
    expect(await getBusiness(db)).toBeNull();
  });

  it('no se puede configurar dos veces el mismo celular', async () => {
    await setupBusiness(db, c, doñaRosa);
    await expect(setupBusiness(db, c, { ...doñaRosa, businessName: 'Otra' })).rejects.toMatchObject({ code: 'YA_CONFIGURADO' });
    expect((await listLocalUsers(db)).length).toBe(1);
  });

  it('el PIN no se guarda tal cual', async () => {
    await setupBusiness(db, c, doñaRosa);
    const row = await db.get<{ pin_hash: string }>('SELECT pin_hash FROM local_users');
    expect(row?.pin_hash).not.toContain('2580');
    expect(row?.pin_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('entrar con PIN', () => {
  it('abre con el PIN correcto y no con otro', async () => {
    const { owner } = await setupBusiness(db, c, doñaRosa);
    expect(await unlock(db, c, owner.id, '2580')).toMatchObject({ ok: true, user: { name: 'Rosa' } });
    expect(await unlock(db, c, owner.id, '0000')).toMatchObject({ ok: false, code: 'PIN_INCORRECTO', remainingAttempts: 4 });
  });

  it('tras 5 intentos fallidos espera 5 minutos, y luego vuelve a abrir', async () => {
    const { owner } = await setupBusiness(db, c, doñaRosa);
    const t0 = new Date('2026-10-12T10:00:00Z');
    for (let i = 0; i < 4; i++) await unlock(db, c, owner.id, '1111', t0);
    const fifth = await unlock(db, c, owner.id, '1111', t0);
    expect(fifth).toMatchObject({ ok: false, code: 'BLOQUEADO' });
    // Bloqueado: ni con el PIN correcto.
    const during = await unlock(db, c, owner.id, '2580', new Date(t0.getTime() + 60_000));
    expect(during).toMatchObject({ ok: false, code: 'BLOQUEADO' });
    expect(during.ok === false && during.message).toMatch(/Espera 4 minutos/);
    const after = await unlock(db, c, owner.id, '2580', new Date(t0.getTime() + 5 * 60_000 + 1));
    expect(after.ok).toBe(true);
  });

  it('un acierto borra los intentos fallidos', async () => {
    const { owner } = await setupBusiness(db, c, doñaRosa);
    for (let i = 0; i < 3; i++) await unlock(db, c, owner.id, '1111');
    await unlock(db, c, owner.id, '2580');
    expect(await unlock(db, c, owner.id, '1111')).toMatchObject({ remainingAttempts: 4 });
  });

  it('cambiar el PIN pide el actual', async () => {
    const { owner } = await setupBusiness(db, c, doñaRosa);
    await expect(changePin(db, c, owner.id, '9999', '4321')).rejects.toBeInstanceOf(LocalError);
    await changePin(db, c, owner.id, '2580', '4321');
    expect((await unlock(db, c, owner.id, '2580')).ok).toBe(false);
    expect((await unlock(db, c, owner.id, '4321')).ok).toBe(true);
  });
});

describe('olvidé mi PIN', () => {
  it('con el código de recuperación (con o sin guion) pone un PIN nuevo y desbloquea', async () => {
    const { owner, recoveryCode } = await setupBusiness(db, c, doñaRosa);
    for (let i = 0; i < 5; i++) await unlock(db, c, owner.id, '1111');
    await expect(resetOwnerPin(db, c, '00000-00000', '7777')).rejects.toMatchObject({ code: 'CODIGO_INCORRECTO' });
    const written = `${recoveryCode.slice(0, 5)}-${recoveryCode.slice(5)}`;
    await resetOwnerPin(db, c, written, '7777');
    expect((await unlock(db, c, owner.id, '7777')).ok).toBe(true);
  });
});

describe('ayudantes en el mismo celular', () => {
  it('el ayudante entra con su PIN como vendedor y se le puede quitar el acceso', async () => {
    const { owner } = await setupBusiness(db, c, doñaRosa);
    const pepe = await addHelper(db, c, { name: 'Pepe', pin: '1357' });
    expect((await listLocalUsers(db)).map((u) => `${u.name}:${u.role}`)).toEqual(['Rosa:ADMIN', 'Pepe:VENDEDOR']);
    expect(await unlock(db, c, pepe.id, '1357')).toMatchObject({ ok: true, user: { role: 'VENDEDOR' } });
    await removeHelper(db, pepe.id);
    expect((await listLocalUsers(db)).map((u) => u.name)).toEqual(['Rosa']);
    await expect(unlock(db, c, pepe.id, '1357')).rejects.toMatchObject({ code: 'USUARIO_NO_EXISTE' });
    await expect(removeHelper(db, owner.id)).rejects.toMatchObject({ code: 'NO_PERMITIDO' });
  });
});

describe('datos del negocio', () => {
  it('se editan sin pedir datos tributarios', async () => {
    await setupBusiness(db, c, doñaRosa);
    const b = await updateBusiness(db, { name: 'Minimarket Rosa', phone: '987654321', defaultCreditLimitCents: 10000 });
    expect(b).toMatchObject({ name: 'Minimarket Rosa', phone: '987654321', defaultCreditLimitCents: 10000 });
    await expect(updateBusiness(db, { overdueDays: -1 })).rejects.toThrow('no es válido');
    expect(businessSettings(b).defaultCreditLimitCents).toBe(10000);
  });
});
