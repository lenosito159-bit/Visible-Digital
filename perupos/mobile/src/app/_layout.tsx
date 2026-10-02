import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync();

function RootStack() {
  const { ready } = useAuth();
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.secondary },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { fontWeight: '800', fontSize: 20 },
        contentStyle: { backgroundColor: colors.background },
        headerBackTitle: 'Atrás',
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="vendedor" options={{ title: 'PeruPOS' }} />
      <Stack.Screen name="pos" options={{ title: 'Nueva venta' }} />
      <Stack.Screen name="scanner" options={{ title: 'Escanear', presentation: 'fullScreenModal', headerShown: false }} />
      <Stack.Screen name="product-new" options={{ title: 'Producto nuevo' }} />
      <Stack.Screen name="checkout" options={{ title: 'Cobrar' }} />
      <Stack.Screen name="receipt/[id]" options={{ title: 'Comprobante', headerBackVisible: false }} />
      <Stack.Screen name="my-sales" options={{ title: 'Mis ventas' }} />
      <Stack.Screen name="customers/index" options={{ title: 'Clientes' }} />
      <Stack.Screen name="customers/[id]" options={{ title: 'Cliente' }} />
      <Stack.Screen name="abono" options={{ title: 'Registrar abono' }} />
      <Stack.Screen name="debts" options={{ title: 'Fiados por cobrar' }} />
      <Stack.Screen name="cash" options={{ title: 'Caja' }} />
      <Stack.Screen name="alerts" options={{ title: 'Alertas' }} />
      <Stack.Screen name="admin/index" options={{ title: 'Administrador' }} />
      <Stack.Screen name="admin/products" options={{ title: 'Productos' }} />
      <Stack.Screen name="admin/product/[id]" options={{ title: 'Editar producto' }} />
      <Stack.Screen name="admin/users" options={{ title: 'Usuarios' }} />
      <Stack.Screen name="admin/settings" options={{ title: 'Mi negocio' }} />
      <Stack.Screen name="admin/reports" options={{ title: 'Reportes' }} />
      <Stack.Screen name="agente/index" options={{ title: 'Agente Financiero' }} />
      <Stack.Screen name="agente/send" options={{ title: 'Enviar recomendación', presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <RootStack />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
