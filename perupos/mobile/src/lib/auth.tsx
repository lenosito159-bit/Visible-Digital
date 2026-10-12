import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  businessSettings,
  can,
  getBusiness,
  migrateLocal,
  setupBusiness,
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
import * as apiClient from './api';
import * as db from './db';
import { localCrypto, localDb } from './localDb';
import { SERVER_ENABLED } from './mode';
import { registerForPush } from './notifications';
import { startSyncLoop, syncNow, onDataChanged } from './sync';

interface AuthContextValue {
  ready: boolean;
  user: User | null;
  settings: BusinessSettings | null;
  /** Negocio guardado en el celular (null = falta la primera configuración). */
  business: LocalBusiness | null;
  can: (permission: Permission) => boolean;
  /** Primera vez: crea el negocio y al dueño. Devuelve el código de recuperación. */
  setup: (input: SetupInput) => Promise<string>;
  /** Entrar con PIN, sin servidor. */
  unlock: (userId: string, pin: string) => Promise<UnlockResult>;
  /** Volver a leer el negocio después de editarlo. */
  reloadBusiness: () => Promise<void>;
  /** Solo con el módulo de servidor encendido. */
  login: (username: string, secret: string, role: Role) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface RecentUser {
  username: string;
  name: string;
  role: Role;
}

/** Usuarios que ya ingresaron en este teléfono: se muestran como botones en el login. */
export async function recentUsers(): Promise<RecentUser[]> {
  return (await db.getKv<RecentUser[]>('recentUsers')) ?? [];
}

async function rememberUser(user: User) {
  const list = (await recentUsers()).filter((u) => u.username !== user.username);
  await db.setKv('recentUsers', [{ username: user.username, name: user.name, role: user.role }, ...list].slice(0, 6));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [business, setBusiness] = useState<LocalBusiness | null>(null);
  const [serverSettings, setServerSettings] = useState<BusinessSettings | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      await db.initDb();
      await migrateLocal(localDb);
      const localBusiness = await getBusiness(localDb);
      if (!alive) return;
      setBusiness(localBusiness);
      if (SERVER_ENABLED) {
        const session = await apiClient.loadSession();
        if (!alive) return;
        // Con sesión guardada la app abre aunque no haya internet.
        setUser(session?.user ?? null);
        setServerSettings(await db.getSettings());
        if (session) {
          startSyncLoop();
          void syncNow();
          void registerForPush();
        }
      }
      // Sin servidor la app siempre abre bloqueada: se entra con el PIN.
      setReady(true);
    })();
    if (!SERVER_ENABLED) return () => void (alive = false);
    apiClient.setSessionExpiredHandler(() => setUser(null));
    const off = onDataChanged(() => void db.getSettings().then(setServerSettings));
    return () => {
      alive = false;
      off();
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
      if (result.ok) setUser(toAppUser(result.user, business?.createdAt ?? new Date().toISOString()));
      return result;
    },
    [business],
  );

  const reloadBusiness = useCallback(async () => {
    setBusiness(await getBusiness(localDb));
  }, []);

  const login = useCallback(async (username: string, secret: string, role: Role) => {
    if (!SERVER_ENABLED) throw new apiClient.ServerDisabledError();
    const session = await apiClient.login(username, secret, role);
    const previous = await db.getKv<string>('lastUserId');
    // Otro usuario en el mismo teléfono: se baja todo el catálogo de nuevo.
    if (previous && previous !== session.user.id) {
      await db.setKv('lastPull', null);
    }
    await db.setKv('lastUserId', session.user.id);
    await rememberUser(session.user);
    startSyncLoop();
    await syncNow();
    setServerSettings(await db.getSettings());
    setUser(session.user);
    void registerForPush();
  }, []);

  const logout = useCallback(async () => {
    if (SERVER_ENABLED) await apiClient.logout();
    setUser(null);
  }, []);

  const settings = SERVER_ENABLED ? serverSettings : business ? businessSettings(business) : null;

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
      login,
      logout,
    }),
    [ready, user, settings, business, setup, unlock, reloadBusiness, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}

/** Pantalla a la que va la app cuando no hay nadie adentro. */
export function entryRoute(business: LocalBusiness | null): '/login' | '/setup' | '/unlock' {
  if (SERVER_ENABLED) return '/login';
  return business ? '/unlock' : '/setup';
}

/** Pantalla de inicio de cada rol. */
export function homeFor(role: Role): '/vendedor' | '/admin' | '/agente' {
  return role === 'ADMIN' ? '/admin' : role === 'AGENTE' ? '/agente' : '/vendedor';
}
