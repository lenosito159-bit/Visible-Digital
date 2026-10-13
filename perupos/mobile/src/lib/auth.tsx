import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  businessSettings,
  can,
  endDemo as endLocalDemo,
  getBusiness,
  migrateLocal,
  setupBusiness,
  setupDemo,
  toAppUser,
  unlock as unlockLocal,
  type BusinessSettings,
  type LocalBusiness,
  type Permission,
  type Role,
  type SetupInput,
  type UnlockResult,
  type User,
} from '@perupos/shared';
import * as db from './db';
import { localCrypto, localDb } from './localDb';
import { checkAlerts } from './store';

/**
 * Sesión en el celular: el negocio guardado y quién entró con su PIN.
 * No hay cuentas ni servidor: al abrir la app siempre se pide el PIN.
 */
interface AuthContextValue {
  ready: boolean;
  user: User | null;
  settings: BusinessSettings | null;
  /** Negocio guardado en el celular (null = falta la primera configuración). */
  business: LocalBusiness | null;
  can: (permission: Permission) => boolean;
  /** Primera vez: crea el negocio y al dueño. Devuelve el código de recuperación. */
  setup: (input: SetupInput) => Promise<string>;
  /** Entrar con PIN. */
  unlock: (userId: string, pin: string) => Promise<UnlockResult>;
  /** Volver a leer el negocio después de editarlo o recuperar una copia. */
  reloadBusiness: () => Promise<void>;
  /** Modo demostración: negocio de ejemplo con 20 productos (PIN 1234). */
  startDemo: () => Promise<void>;
  /** Borra la demostración entera para configurar el negocio real. */
  endDemo: () => Promise<void>;
  /** Salir (bloquear): se vuelve a pedir el PIN. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [business, setBusiness] = useState<LocalBusiness | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      await db.initDb();
      await migrateLocal(localDb);
      const localBusiness = await getBusiness(localDb);
      if (!alive) return;
      setBusiness(localBusiness);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const setup = useCallback(async (input: SetupInput) => {
    const result = await setupBusiness(localDb, localCrypto, input);
    setBusiness(result.business);
    setUser(toAppUser(result.owner, result.business.createdAt));
    return result.recoveryCode;
  }, []);

  const unlock = useCallback(
    async (userId: string, pin: string) => {
      const result = await unlockLocal(localDb, localCrypto, userId, pin);
      if (result.ok) {
        setUser(toAppUser(result.user, business?.createdAt ?? new Date().toISOString()));
        // Al entrar se revisan los avisos (stock bajo, deudas vencidas…) y se notifican en el celular.
        void checkAlerts();
      }
      return result;
    },
    [business],
  );

  const reloadBusiness = useCallback(async () => {
    setBusiness(await getBusiness(localDb));
  }, []);

  const startDemo = useCallback(async () => {
    const demo = await setupDemo(localDb, localCrypto);
    setBusiness(demo.business);
    setUser(toAppUser(demo.owner, demo.business.createdAt));
  }, []);

  const endDemo = useCallback(async () => {
    await endLocalDemo(localDb);
    setUser(null);
    setBusiness(null);
  }, []);

  const logout = useCallback(async () => {
    setUser(null);
  }, []);

  const settings = business ? businessSettings(business) : null;

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      user,
      settings,
      business,
      can: (permission) => !!user && can(user.role, permission),
      setup,
      unlock,
      reloadBusiness,
      startDemo,
      endDemo,
      logout,
    }),
    [ready, user, settings, business, setup, unlock, reloadBusiness, startDemo, endDemo, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}

/** Pantalla a la que va la app cuando no hay nadie adentro. */
export function entryRoute(business: LocalBusiness | null): '/setup' | '/unlock' {
  return business ? '/unlock' : '/setup';
}

/** Pantalla de inicio de cada rol (en el celular: dueño o ayudante). */
export function homeFor(role: Role): '/vendedor' | '/admin' {
  return role === 'ADMIN' ? '/admin' : '/vendedor';
}
