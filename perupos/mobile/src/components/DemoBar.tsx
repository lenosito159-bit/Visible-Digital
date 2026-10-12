import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { colors, font } from '@/theme';

/** Franja visible en todas las pantallas mientras se usa la demostración. */
export function DemoBar() {
  const { business } = useAuth();
  if (!business?.isDemo) return null;
  return (
    <View style={styles.bar} accessibilityRole="text">
      <Ionicons name="flask" size={16} color={colors.text} />
      <Text style={styles.text}>DEMOSTRACIÓN · datos de ejemplo, no son de tu negocio</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: colors.accent },
  text: { fontSize: font.small, fontWeight: '800', color: colors.text, flex: 1 },
});
