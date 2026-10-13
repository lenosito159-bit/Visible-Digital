import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Configuración dinámica encima de app.json.
 *
 * La app funciona solo en el celular y no se conecta a ningún servidor: Android
 * no permite conexiones http:// (sin cifrar) en ningún perfil.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  plugins: [...(config.plugins ?? []), ['expo-build-properties', { android: { usesCleartextTraffic: false } }]],
});
