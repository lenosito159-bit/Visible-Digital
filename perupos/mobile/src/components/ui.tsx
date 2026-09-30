import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatSoles } from '@perupos/shared';
import { colors, font, shared, spacing, TOUCH } from '@/theme';
import { ConnectionBar } from './ConnectionBar';

export type IconName = ComponentProps<typeof Ionicons>['name'];

type Variant = 'primary' | 'secondary' | 'accent' | 'danger' | 'ghost' | 'yape' | 'plin';

const VARIANTS: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.primaryDark, fg: '#FFFFFF' },
  secondary: { bg: colors.secondary, fg: '#FFFFFF' },
  // Ámbar con texto oscuro: alto contraste para acciones destacadas.
  accent: { bg: colors.accent, fg: colors.text },
  danger: { bg: colors.danger, fg: '#FFFFFF' },
  ghost: { bg: colors.surface, fg: colors.secondary, border: colors.border },
  yape: { bg: colors.yape, fg: '#FFFFFF' },
  plin: { bg: colors.plin, fg: colors.text },
};

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  loading,
  big,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  big?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const v = VARIANTS[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        big && styles.buttonBig,
        { backgroundColor: v.bg, borderColor: v.border ?? v.bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={big ? 28 : 22} color={v.fg} />}
          <Text style={[styles.buttonText, big && styles.buttonTextBig, { color: v.fg }]} numberOfLines={2}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/** Botón grande de la pantalla de inicio: ícono + texto. */
export function Tile({
  label,
  icon,
  onPress,
  color = colors.primaryDark,
  badge,
  subtitle,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  color?: string;
  badge?: number;
  subtitle?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { backgroundColor: color, opacity: pressed ? 0.85 : 1 }]}
    >
      <Ionicons name={icon} size={44} color="#FFFFFF" />
      <Text style={styles.tileText}>{label}</Text>
      {subtitle ? <Text style={styles.tileSubtitle}>{subtitle}</Text> : null}
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
  color = colors.secondary,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: IconName;
  color?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected ? { backgroundColor: color, borderColor: color } : null]}
    >
      {icon && <Ionicons name={icon} size={18} color={selected ? '#FFFFFF' : color} />}
      <Text style={[styles.chipText, { color: selected ? '#FFFFFF' : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Screen({
  children,
  scroll = true,
  padded = true,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  footer?: ReactNode;
}) {
  const content = padded ? <View style={styles.padded}>{children}</View> : children;
  return (
    <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
      <ConnectionBar />
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing.xxl }}>
          {content}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{content}</View>
      )}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={shared.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        {...props}
        style={[shared.input, error ? { borderColor: colors.danger } : null, props.style]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function Money({ cents, size = font.body, color = colors.text, bold = true }: { cents: number; size?: number; color?: string; bold?: boolean }) {
  return <Text style={{ fontSize: size, color, fontWeight: bold ? '800' : '500', fontVariant: ['tabular-nums'] }}>{formatSoles(cents)}</Text>;
}

export function Banner({ text, tone = 'info', icon }: { text: string; tone?: 'info' | 'warning' | 'danger' | 'success'; icon?: IconName }) {
  const palette = {
    info: { bg: colors.secondarySoft, fg: colors.secondary, icon: 'information-circle' as IconName },
    warning: { bg: colors.accentSoft, fg: '#92400E', icon: 'warning' as IconName },
    danger: { bg: colors.dangerSoft, fg: colors.danger, icon: 'alert-circle' as IconName },
    success: { bg: colors.primarySoft, fg: colors.primaryDark, icon: 'checkmark-circle' as IconName },
  }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: palette.bg }]}>
      <Ionicons name={icon ?? palette.icon} size={22} color={palette.fg} />
      <Text style={[styles.bannerText, { color: palette.fg }]}>{text}</Text>
    </View>
  );
}

export function Empty({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={48} color={colors.textMuted} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

export function StatCard({ label, cents, value, tone = colors.secondary, icon }: { label: string; cents?: number; value?: string; tone?: string; icon?: IconName }) {
  return (
    <View style={[shared.card, styles.stat]}>
      <View style={shared.row}>
        {icon && <Ionicons name={icon} size={18} color={tone} style={{ marginRight: 6 }} />}
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      {cents !== undefined ? <Money cents={cents} size={font.large} color={tone} /> : <Text style={[styles.statValue, { color: tone }]}>{value}</Text>}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.empty}>
      <ActivityIndicator size="large" color={colors.primaryDark} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  padded: { padding: spacing.lg },
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  button: {
    minHeight: TOUCH + 8,
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 2,
  },
  buttonBig: { minHeight: 72 },
  buttonText: { fontSize: font.body, fontWeight: '800', textAlign: 'center' },
  buttonTextBig: { fontSize: font.large },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 132,
    borderRadius: 18,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  tileText: { color: '#FFFFFF', fontSize: font.large, fontWeight: '800', textAlign: 'center' },
  tileSubtitle: { color: '#FFFFFF', fontSize: font.small, opacity: 0.9, textAlign: 'center' },
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: colors.text, fontWeight: '900' },
  chip: {
    minHeight: TOUCH,
    paddingHorizontal: spacing.lg,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipText: { fontSize: font.body, fontWeight: '700' },
  error: { color: colors.danger, marginTop: 4, fontSize: font.small, fontWeight: '600' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: 12, marginBottom: spacing.md },
  bannerText: { flex: 1, fontSize: font.body, fontWeight: '600' },
  empty: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  emptyText: { fontSize: font.body, color: colors.textMuted, textAlign: 'center' },
  stat: { flexGrow: 1, flexBasis: '45%', gap: 4, padding: spacing.md },
  statLabel: { fontSize: font.small, color: colors.textMuted, fontWeight: '700' },
  statValue: { fontSize: font.large, fontWeight: '800' },
});
