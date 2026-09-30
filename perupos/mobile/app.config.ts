import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Configuración dinámica encima de app.json.
 *
 * Android bloquea las conexiones http:// (sin HTTPS) en los builds de release.
 * Para probar el APK contra el servidor de tu computadora (http://192.168.x.x:3000)
 * se permite http en todos los perfiles menos en "production", que debe usar HTTPS.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const production = process.env.EAS_BUILD_PROFILE === 'production';
  return {
    ...(config as ExpoConfig),
    plugins: [
      ...(config.plugins ?? []),
      ['expo-build-properties', { android: { usesCleartextTraffic: !production } }],
    ],
  };
};
