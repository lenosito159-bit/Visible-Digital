import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { PUSH_CHANNELS } from '@perupos/shared';
import { api } from './api';

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
