import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { PUSH_CHANNELS, type LocalAlert } from '@perupos/shared';

/**
 * Notificaciones del propio celular (sin internet, sin servidor): los avisos
 * de stock bajo, deudas vencidas, etc. que calcula la app.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // Un canal por tipo de aviso: el tendero puede silenciar uno desde Ajustes sin perder los demás.
  for (const channel of Object.values(PUSH_CHANNELS)) {
    await Notifications.setNotificationChannelAsync(channel.id, {
      name: channel.name,
      importance: Notifications.AndroidImportance[channel.importance],
      vibrationPattern: channel.importance === 'LOW' ? undefined : [0, 250, 250, 250],
      lightColor: '#10B981',
    });
  }
}

let ready: Promise<boolean> | null = null;

/** Pide permiso una sola vez. */
function permission(): Promise<boolean> {
  ready ??= (async () => {
    try {
      await ensureChannels();
      const current = await Notifications.getPermissionsAsync();
      const status = current.granted ? current : await Notifications.requestPermissionsAsync();
      return status.granted;
    } catch {
      return false;
    }
  })();
  return ready;
}

/**
 * Muestra en el celular los avisos nuevos. Solo se revisan mientras la app se
 * usa (al entrar y después de vender, abonar o mover stock); con la app
 * cerrada no llegan avisos.
 */
export async function notifyLocalAlerts(alerts: LocalAlert[]): Promise<void> {
  if (alerts.length === 0 || !(await permission())) return;
  const shown = alerts.slice(0, 3);
  for (const a of shown) {
    await Notifications.scheduleNotificationAsync({
      content: { title: a.title, body: a.message, data: { alertKey: a.key, entityId: a.entityId, type: a.type } },
      trigger: Platform.OS === 'android' ? { channelId: PUSH_CHANNELS[a.type].id } : null,
    });
  }
  if (alerts.length > shown.length) {
    await Notifications.scheduleNotificationAsync({
      content: { title: `${alerts.length - shown.length} avisos más`, body: 'Ábrelos en Avisos.', data: {} },
      trigger: Platform.OS === 'android' ? { channelId: PUSH_CHANNELS.MENSAJES.id } : null,
    });
  }
}
