import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Configuración dinámica encima de app.json.
 *
 * La app funciona sin servidor y no se conecta a internet. Solo si se activa el
 * módulo de servidor (EXPO_PUBLIC_SERVER_ENABLED=true) y no es "production", se
 * permite http:// para probar contra la computadora (http://192.168.x.x:3000).
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const production = process.env.EAS_BUILD_PROFILE === 'production';
  const server = process.env.EXPO_PUBLIC_SERVER_ENABLED === 'true';
  return {
    ...(config as ExpoConfig),
    plugins: [
      ...(config.plugins ?? []),
      ['expo-build-properties', { android: { usesCleartextTraffic: server && !production } }],
    ],
  };
};
