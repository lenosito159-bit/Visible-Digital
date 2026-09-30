import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import type { AuthTokens, Role, User } from '@perupos/shared';

/** URL del backend: EXPO_PUBLIC_API_URL o "extra.apiUrl" de app.json. */
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  'http://localhost:3000'
).replace(/\/$/, '');

const SESSION_KEY = 'perupos.session';

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: User;
}

/** Error que viene del servidor, con un mensaje listo para mostrar. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** No hay internet o el servidor no responde. La app sigue funcionando en modo offline. */
export class OfflineError extends Error {
  constructor() {
    super('Sin conexión. Se guardó en el teléfono y se enviará al volver el internet.');
  }
}

let session: Session | null = null;
let onSessionExpired: (() => void) | null = null;

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  session = raw ? (JSON.parse(raw) as Session) : null;
  return session;
}

export async function saveSession(next: Session | null): Promise<void> {
  session = next;
  if (next) await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(next));
  else await SecureStore.deleteItemAsync(SESSION_KEY);
}

export function currentSession(): Session | null {
  return session;
}

export function setSessionExpiredHandler(fn: (() => void) | null): void {
  onSessionExpired = fn;
}

export function imageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^(https?:|file:|content:|data:)/.test(path)) return path;
  return `${API_URL}${path}`;
}

async function rawFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${API_URL}${path}`, { ...init, signal: controller.signal });
  } catch {
    throw new OfflineError();
  } finally {
    clearTimeout(timer);
  }
}

let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!session) return false;
  refreshing ??= (async () => {
    try {
      const res = await rawFetch(
        '/auth/refresh',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: session!.refreshToken }) },
        15_000,
      );
      if (!res.ok) return false;
      const data = (await res.json()) as AuthTokens;
      await saveSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
      return true;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  timeoutMs?: number;
  raw?: boolean;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const send = () => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (session) headers.Authorization = `Bearer ${session.accessToken}`;
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    return rawFetch(path, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body }, opts.timeoutMs ?? 20_000);
  };

  let res = await send();
  if (res.status === 401 && session && !path.startsWith('/auth/login')) {
    if (await refreshSession()) res = await send();
    else {
      await saveSession(null);
      onSessionExpired?.();
    }
  }
  if (opts.raw && res.ok) return (await res.text()) as T;
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = data as { error?: string; code?: string; details?: unknown } | null;
    throw new ApiError(res.status, err?.error ?? `Error ${res.status}`, err?.code ?? 'ERROR', err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown = {}) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body }),
  text: (path: string) => request<string>(path, { raw: true }),
};

export async function login(username: string, secret: string, role: Role): Promise<Session> {
  const data = await request<AuthTokens>('/auth/login', { method: 'POST', body: { username, secret, role } });
  const next = { accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user };
  await saveSession(next);
  return next;
}

export async function logout(): Promise<void> {
  const refreshToken = session?.refreshToken;
  await saveSession(null);
  if (refreshToken) {
    request('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => {});
  }
}

/** Mensaje amable para cualquier error. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof OfflineError) return err.message;
  return 'Algo salió mal. Intenta de nuevo.';
}
