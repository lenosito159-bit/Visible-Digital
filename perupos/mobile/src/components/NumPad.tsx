import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font } from '@/theme';

/**
 * Teclado numérico grande. Más fácil que el teclado del sistema para
 * escribir un PIN o un monto con los dedos, incluso con guantes.
 */
export function NumPad({ onKey, decimal = false }: { onKey: (key: string) => void; decimal?: boolean }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimal ? '.' : '', '0', 'del'];
  return (
    <View style={styles.grid}>
      {keys.map((k, i) =>
        k === '' ? (
          <View key={i} style={styles.key} />
        ) : (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={k === 'del' ? 'Borrar' : k}
            onPress={() => onKey(k)}
            style={({ pressed }) => [styles.key, styles.keyActive, pressed && { backgroundColor: colors.secondarySoft }]}
          >
            {k === 'del' ? <Ionicons name="backspace" size={30} color={colors.secondary} /> : <Text style={styles.text}>{k}</Text>}
          </Pressable>
        ),
      )}
    </View>
  );
}

/** Aplica una tecla a un texto numérico (con máximo 2 decimales). */
export function applyKey(value: string, key: string, maxLength = 9): string {
  if (key === 'del') return value.slice(0, -1);
  if (key === '.' && value.includes('.')) return value;
  if (value.includes('.') && value.split('.')[1]!.length >= 2) return value;
  if (value.length >= maxLength) return value;
  if (key === '.' && value === '') return '0.';
  return value + key;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  key: { width: '30%', height: 64, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  keyActive: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border },
  text: { fontSize: font.huge - 6, fontWeight: '800', color: colors.text },
});
