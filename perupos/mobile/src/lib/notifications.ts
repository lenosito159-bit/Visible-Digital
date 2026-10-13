import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { PUSH_CHANNELS, type LocalAlert } from '@perupos/shared';
import { api } from './api';
import { SERVER_ENABLED } from './mode';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Pide permiso y registra el token de Expo para recibir las alertas del
 * Agente Financiero (stock bajo, deudas vencidas, caja baja...).
 */
export async function registerForPush(): Promise<void> {
  // Las notificaciones por internet (Expo) son del módulo de servidor: apagado, no se pide token.
  if (!SERVER_ENABLED) return;
  try {
    if (Platform.OS === 'android') {
      // Un canal por tipo de alerta: el tendero puede silenciar uno desde Ajustes sin perder los demás.
      for (const channel of Object.values(PUSH_CHANNELS)) {
        await Notifications.setNotificationChannelAsync(channel.id, {
          name: channel.name,
          importance: Notifications.AndroidImportance[channel.importance],
          vibrationPattern: channel.importance === 'LOW' ? undefined : [0, 250, 250, 250],
          lightColor: '#10B981',
        });
      }
    }
    if (!Device.isDevice) return;
    const current = await Notifications.getPermissionsAsync();
    const status = current.granted ? current : await Notifications.requestPermissionsAsync();
    if (!status.granted) return;
    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await api.post('/auth/push-token', { token: token.data });
  } catch (err) {
    // Sin push igual se ven las alertas dentro de la app.
    console.warn('Push no disponible:', (err as Error).message);
  }
}

async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  for (const channel of Object.values(PUSH_CHANNELS)) {
    await Notifications.setNotificationChannelAsync(channel.id, {
      name: channel.name,
      importance: Notifications.AndroidImportance[channel.importance],
      vibrationPattern: channel.importance === 'LOW' ? undefined : [0, 250, 250, 250],
      lightColor: '#10B981',
    });
  }
}

let localReady: Promise<boolean> | null = null;

/** Pide permiso una vez para avisos del propio celular (sin internet, sin servidor). */
function localPermission(): Promise<boolean> {
  localReady ??= (async () => {
    try {
      await ensureChannels();
      const current = await Notifications.getPermissionsAsync();
      const status = current.granted ? current : await Notifications.requestPermissionsAsync();
      return status.granted;
    } catch {
      return false;
    }
  })();
  return localReady;
}

/**
 * Muestra en el celular los avisos nuevos (stock bajo, deudas vencidas…).
 * Se calculan y se muestran en el mismo teléfono: no pasa nada por internet.
 * Solo se revisan mientras la app se usa (al entrar y después de vender,
 * abonar o mover stock); con la app cerrada no llegan avisos.
 */
export async function notifyLocalAlerts(alerts: LocalAlert[]): Promise<void> {
  if (alerts.length === 0 || !(await localPermission())) return;
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
