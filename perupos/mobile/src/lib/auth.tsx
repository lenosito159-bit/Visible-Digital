import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { can, type BusinessSettings, type Permission, type Role, type User } from '@perupos/shared';
import * as apiClient from './api';
import * as db from './db';
import { registerForPush } from './notifications';
import { startSyncLoop, syncNow, onDataChanged } from './sync';

interface AuthContextValue {
  ready: boolean;
  user: User | null;
  settings: BusinessSettings | null;
  can: (permission: Permission) => boolean;
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
  const [settings, setSettings] = useState<BusinessSettings | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      await db.initDb();
      const session = await apiClient.loadSession();
      if (!alive) return;
      // Con sesión guardada la app abre aunque no haya internet.
      setUser(session?.user ?? null);
      setSettings(await db.getSettings());
      setReady(true);
      if (session) {
        startSyncLoop();
        void syncNow();
        void registerForPush();
      }
    })();
    apiClient.setSessionExpiredHandler(() => setUser(null));
    const off = onDataChanged(() => void db.getSettings().then(setSettings));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const login = useCallback(async (username: string, secret: string, role: Role) => {
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
    setSettings(await db.getSettings());
    setUser(session.user);
    void registerForPush();
  }, []);

  const logout = useCallback(async () => {
    await apiClient.logout();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      user,
      settings,
      can: (permission) => !!user && can(user.role, permission),
      login,
      logout,
    }),
    [ready, user, settings, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}

/** Pantalla de inicio de cada rol. */
export function homeFor(role: Role): '/vendedor' | '/admin' | '/agente' {
  return role === 'ADMIN' ? '/admin' : role === 'AGENTE' ? '/agente' : '/vendedor';
}
