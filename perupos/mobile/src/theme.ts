import { StyleSheet } from 'react-native';

/**
 * Paleta PeruPOS. El verde esmeralda (#10B981) es la marca; para fondos de
 * botones con texto blanco se usa un verde más oscuro (#047857) porque el
 * esmeralda claro no da contraste suficiente bajo el sol del mostrador.
 */
export const colors = {
  primary: '#10B981',
  primaryDark: '#047857',
  primarySoft: '#D1FAE5',
  secondary: '#1E3A5F',
  secondarySoft: '#E0E7EF',
  accent: '#F59E0B',
  accentSoft: '#FEF3C7',
  danger: '#B91C1C',
  dangerSoft: '#FEE2E2',
  background: '#F9FAFB',
  surface: '#FFFFFF',
  text: '#111827',
  textMuted: '#4B5563',
  border: '#D1D5DB',
  yape: '#6C2C91',
  plin: '#00A5B5',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

/** Área táctil mínima: 48 px (usamos 56+ en acciones principales). */
export const TOUCH = 48;

export const font = {
  small: 14,
  body: 17,
  large: 20,
  title: 24,
  huge: 36,
};

export const shared = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  label: { fontSize: font.small, color: colors.textMuted, fontWeight: '600', marginBottom: spacing.xs },
  input: {
    minHeight: TOUCH + 4,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    fontSize: font.large,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  sectionTitle: { fontSize: font.large, fontWeight: '800', color: colors.secondary, marginBottom: spacing.sm },
});
