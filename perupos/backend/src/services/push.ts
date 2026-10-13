import { PUSH_CHANNELS, type Role } from '@perupos/shared';
import { config } from '../config.js';
import { many, pool } from '../db/pool.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Canal de Android (ver PUSH_CHANNELS). */
  channelId?: string;
}

/** Mensajes para la API de push de Expo (máximo 100 por envío). */
export function buildPushBatches(tokens: string[], message: PushMessage) {
  const batches = [];
  for (let i = 0; i < tokens.length; i += 100) {
    batches.push(
      tokens.slice(i, i + 100).map((to) => ({
        to,
        title: message.title,
        body: message.body,
        data: message.data ?? {},
        sound: 'default',
        priority: 'high',
        channelId: message.channelId ?? PUSH_CHANNELS.MENSAJES.id,
      })),
    );
  }
  return batches;
}

/** Envía una notificación push (Expo) a todos los usuarios activos de esos roles. */
export async function pushToRoles(roles: Role[], message: PushMessage): Promise<number> {
  const rows = await many<{ token: string }>(
    pool,
    `SELECT t.token FROM push_tokens t JOIN users u ON u.id = t.user_id
      WHERE u.active AND u.role = ANY($1::text[])`,
    [roles],
  );
  return sendPush(
    rows.map((r) => r.token),
    message,
  );
}

export async function sendPush(tokens: string[], message: PushMessage): Promise<number> {
  if (!config.PUSH_ENABLED || tokens.length === 0) return 0;
  let sent = 0;
  for (const batch of buildPushBatches(tokens, message)) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(config.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${config.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(batch),
      });
      const json = (await res.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null;
      const results = json?.data ?? [];
      results.forEach((r, idx) => {
        if (r.status === 'ok') sent++;
        // El teléfono desinstaló la app o cambió de token: se deja de usar.
        if (r.details?.error === 'DeviceNotRegistered') {
          void pool.query('DELETE FROM push_tokens WHERE token = $1', [batch[idx]!.to]);
        }
      });
    } catch (err) {
      console.warn('No se pudo enviar push:', (err as Error).message);
    }
  }
  return sent;
}
