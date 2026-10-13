import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { can, type Permission, type Role } from '@perupos/shared';
import { config } from '../config.js';
import { HttpError, forbidden } from './errors.js';

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const ACCESS_TTL = '12h';
export const REFRESH_TTL_DAYS = 30;
const OVERRIDE_TTL = '10m';

export function signAccessToken(user: AuthUser): string {
  return jwt.sign({ role: user.role, name: user.name, typ: 'access' }, config.JWT_SECRET, {
    subject: user.id,
    expiresIn: ACCESS_TTL,
  });
}

export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type OverridePurpose = 'DISCOUNT' | 'CREDIT';

/**
 * Autorización puntual del Admin: el dueño escribe su PIN en el teléfono del
 * vendedor y se emite un token válido 10 minutos, solo para esa venta.
 */
export function signOverrideToken(adminId: string, purpose: OverridePurpose, saleId: string): string {
  return jwt.sign({ typ: 'override', purpose, saleId }, config.JWT_SECRET, {
    subject: adminId,
    expiresIn: OVERRIDE_TTL,
  });
}

export function verifyOverrideToken(token: string, purpose: OverridePurpose, saleId: string): string | null {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as jwt.JwtPayload;
    if (payload.typ !== 'override' || payload.saleId !== saleId) return null;
    if (payload.purpose !== purpose) return null;
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new HttpError(401, 'Inicia sesión para continuar.', 'SIN_SESION');
  }
  try {
    const payload = jwt.verify(header.slice(7), config.JWT_SECRET) as jwt.JwtPayload;
    if (payload.typ !== 'access' || !payload.sub) throw new Error('tipo de token');
    req.user = { id: payload.sub, role: payload.role as Role, name: String(payload.name) };
    next();
  } catch {
    throw new HttpError(401, 'Tu sesión venció. Vuelve a ingresar.', 'SESION_VENCIDA');
  }
}

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user || !permissions.some((p) => can(user.role, p))) throw forbidden();
    next();
  };
}

/** Usuario autenticado (para usar después de requireAuth). */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, 'Inicia sesión para continuar.', 'SIN_SESION');
  return req.user;
}
