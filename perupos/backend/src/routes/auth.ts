import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { permissionsFor } from '@perupos/shared';
import { audit, one, pool } from '../db/pool.js';
import {
  REFRESH_TTL_DAYS,
  currentUser,
  hashToken,
  newRefreshToken,
  requireAuth,
  signAccessToken,
  signOverrideToken,
} from '../http/auth.js';
import { HttpError, parse } from '../http/errors.js';
import { toUser } from '../services/mappers.js';

export const authRouter = Router();

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 5;
const DUMMY_HASH = bcrypt.hashSync('perupos', 10);

/** Verifica usuario + PIN/contraseña con bloqueo temporal tras 5 intentos fallidos. */
async function verifyCredentials(username: string, secret: string) {
  const user = await one(pool, 'SELECT * FROM users WHERE username = $1', [username.trim().toLowerCase()]);
  const invalid = new HttpError(401, 'Usuario o PIN incorrecto.', 'CREDENCIALES');
  if (!user || !user.active) {
    // Se compara igual para no revelar si el usuario existe.
    await bcrypt.compare(secret, DUMMY_HASH);
    throw invalid;
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new HttpError(429, `Demasiados intentos. Espera ${LOCK_MINUTES} minutos.`, 'BLOQUEADO');
  }
  if (!(await bcrypt.compare(secret, user.secret_hash))) {
    const lock = user.failed_attempts + 1 >= MAX_ATTEMPTS;
    await pool.query(
      `UPDATE users SET failed_attempts = $2,
         locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE NULL END
       WHERE id = $1`,
      [user.id, lock ? 0 : user.failed_attempts + 1, lock, LOCK_MINUTES],
    );
    throw invalid;
  }
  if (user.failed_attempts > 0 || user.locked_until) {
    await pool.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
  }
  return user;
}

async function issueTokens(user: Record<string, any>) {
  const refresh = newRefreshToken();
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
    [user.id, refresh.hash, REFRESH_TTL_DAYS],
  );
  return {
    accessToken: signAccessToken({ id: user.id, role: user.role, name: user.name }),
    refreshToken: refresh.token,
    user: toUser(user),
    permissions: permissionsFor(user.role),
  };
}

authRouter.post('/login', async (req, res) => {
  const body = parse(
    z.object({ username: z.string().min(1).max(30), secret: z.string().min(1).max(72), role: z.string().optional() }),
    req.body,
  );
  const user = await verifyCredentials(body.username, body.secret);
  // En la pantalla de login se elige el rol primero: si no coincide, se avisa claro.
  if (body.role && body.role !== user.role) {
    throw new HttpError(403, 'Este usuario no tiene ese rol. Elige el rol correcto.', 'ROL_DISTINTO');
  }
  res.json(await issueTokens(user));
});

authRouter.post('/refresh', async (req, res) => {
  const { refreshToken } = parse(z.object({ refreshToken: z.string().min(10) }), req.body);
  const row = await one(
    pool,
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [hashToken(refreshToken)],
  );
  if (!row) throw new HttpError(401, 'Tu sesión venció. Vuelve a ingresar.', 'SESION_VENCIDA');
  const user = await one(pool, 'SELECT * FROM users WHERE id = $1 AND active', [row.user_id]);
  if (!user) throw new HttpError(401, 'Usuario desactivado.', 'SESION_VENCIDA');
  res.json(await issueTokens(user));
});

authRouter.post('/logout', async (req, res) => {
  const { refreshToken } = parse(z.object({ refreshToken: z.string().optional() }), req.body ?? {});
  if (refreshToken) {
    await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [hashToken(refreshToken)]);
  }
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await one(pool, 'SELECT * FROM users WHERE id = $1', [currentUser(req).id]);
  if (!user) throw new HttpError(401, 'Usuario no encontrado.', 'SESION_VENCIDA');
  res.json({ user: toUser(user), permissions: permissionsFor(user.role) });
});

/**
 * El Administrador autoriza en el teléfono del vendedor (descuento > 10 % o
 * fiado sobre el límite) escribiendo su usuario y PIN.
 */
authRouter.post('/authorize', requireAuth, async (req, res) => {
  const body = parse(
    z.object({
      username: z.string().min(1),
      secret: z.string().min(1),
      purpose: z.enum(['DISCOUNT', 'CREDIT']),
      saleId: z.uuid(),
    }),
    req.body,
  );
  const admin = await verifyCredentials(body.username, body.secret);
  if (admin.role !== 'ADMIN') throw new HttpError(403, 'Solo un Administrador puede autorizar.', 'SIN_PERMISO');
  await audit(pool, admin.id, 'EMITE_AUTORIZACION', 'sale', body.saleId, {
    purpose: body.purpose,
    requestedBy: currentUser(req).id,
  });
  res.json({ authorizationToken: signOverrideToken(admin.id, body.purpose, body.saleId), adminName: admin.name });
});

authRouter.post('/push-token', requireAuth, async (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(10).max(300) }), req.body);
  await pool.query(
    `INSERT INTO push_tokens (token, user_id) VALUES ($1, $2)
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = now()`,
    [token, currentUser(req).id],
  );
  res.status(204).end();
});
