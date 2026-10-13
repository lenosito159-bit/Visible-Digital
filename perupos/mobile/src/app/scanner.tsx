import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatSoles } from '@perupos/shared';
import { Button } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { cart, cartTotals, useCart } from '@/lib/cart';
import * as db from '@/lib/db';
import { colors, font, spacing } from '@/theme';

/**
 * Escáner continuo con la cámara trasera: cada código leído se suma al
 * carrito sin salir de la cámara. Si el producto no existe, se crea al toque.
 */
export default function Scanner() {
  const [permission, requestPermission] = useCameraPermissions();
  const { can } = useAuth();
  const { lines } = useCart();
  const { subtotalCents, count } = cartTotals(lines);
  const [last, setLast] = useState<{ text: string; ok: boolean } | null>(null);
  const [torch, setTorch] = useState(false);
  const lastCode = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const busy = useRef(false);

  const onScan = async ({ data }: BarcodeScanningResult) => {
    const code = data.trim();
    const now = Date.now();
    // La cámara lee el mismo código muchas veces por segundo: se ignora 1.5 s.
    if (busy.current || (code === lastCode.current.code && now - lastCode.current.at < 1500)) return;
    busy.current = true;
    lastCode.current = { code, at: now };
    try {
      const product = await db.productByBarcode(code);
      if (product) {
        cart.add(product);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setLast({ text: `${product.name} · ${formatSoles(product.priceCents)}`, ok: true });
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        if (can('products.quickCreate')) {
          router.push({ pathname: '/product-new', params: { barcode: code } });
        } else {
          setLast({ text: `Código ${code} no registrado`, ok: false });
        }
      }
    } finally {
      busy.current = false;
    }
  };

  if (!permission) return <View style={styles.black} />;
  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permission}>
        <Ionicons name="camera" size={64} color={colors.secondary} />
        <Text style={styles.permissionText}>Para escanear, PeruPOS necesita usar la cámara.</Text>
        <Button label="Permitir cámara" icon="camera" big onPress={requestPermission} />
        <Button label="Volver" variant="ghost" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.black}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'qr'] }}
        onBarcodeScanned={onScan}
      />
      <SafeAreaView style={styles.overlay}>
        <View style={styles.topRow}>
          <Pressable accessibilityLabel="Cerrar escáner" onPress={() => router.back()} style={styles.roundButton}>
            <Ionicons name="close" size={30} color="#FFFFFF" />
          </Pressable>
          <Pressable accessibilityLabel="Linterna" onPress={() => setTorch(!torch)} style={styles.roundButton}>
            <Ionicons name={torch ? 'flashlight' : 'flashlight-outline'} size={28} color="#FFFFFF" />
          </Pressable>
        </View>
        <View style={styles.frame} />
        <Text style={styles.help}>Apunta al código de barras del producto</Text>
        {last && (
          <View style={[styles.toast, { backgroundColor: last.ok ? colors.primaryDark : colors.danger }]}>
            <Ionicons name={last.ok ? 'checkmark-circle' : 'alert-circle'} size={24} color="#FFFFFF" />
            <Text style={styles.toastText} numberOfLines={2}>
              {last.ok ? `Agregado: ${last.text}` : last.text}
            </Text>
          </View>
        )}
        <View style={styles.bottom}>
          <Button
            label={count ? `Listo · ${count} productos · ${formatSoles(subtotalCents)}` : 'Volver'}
            icon="checkmark"
            big
            onPress={() => router.back()}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between', padding: spacing.lg },
  topRow: { flexDirection: 'row', justifyContent: 'space-between' },
  roundButton: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  frame: { alignSelf: 'center', width: '85%', height: 180, borderWidth: 4, borderColor: colors.accent, borderRadius: 18 },
  help: { color: '#FFFFFF', fontSize: font.large, fontWeight: '800', textAlign: 'center', textShadowColor: '#000', textShadowRadius: 6 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: 14 },
  toastText: { color: '#FFFFFF', fontSize: font.body, fontWeight: '800', flex: 1 },
  bottom: { gap: spacing.sm },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg, backgroundColor: colors.background },
  permissionText: { fontSize: font.large, textAlign: 'center', color: colors.text },
});
