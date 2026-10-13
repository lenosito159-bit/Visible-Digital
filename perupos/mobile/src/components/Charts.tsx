import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatSoles } from '@perupos/shared';
import { colors, font, spacing } from '@/theme';

export interface Bar {
  label: string;
  value: number;
  secondary?: number;
}

const CHART_HEIGHT = 150;

/**
 * Barras simples (una o dos series). Tocar una barra muestra sus montos:
 * los valores siempre se leen en texto, no solo por color.
 */
export function BarChart({
  data,
  color,
  secondaryColor,
  legend,
}: {
  data: Bar[];
  color: string;
  secondaryColor?: string;
  legend?: [string, string?];
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.secondary ?? 0)));
  const two = data.some((d) => d.secondary !== undefined) && !!secondaryColor;
  const current = selected !== null ? data[selected] : data[data.length - 1];

  return (
    <View style={styles.card}>
      {current && (
        <View style={styles.readout}>
          <Text style={styles.readoutLabel}>{current.label}</Text>
          <Text style={styles.readoutValue}>
            {legend?.[0] ? `${legend[0]}: ` : ''}
            {formatSoles(current.value)}
          </Text>
          {two && current.secondary !== undefined && (
            <Text style={styles.readoutSecondary}>
              {legend?.[1] ? `${legend[1]}: ` : ''}
              {formatSoles(current.secondary)}
            </Text>
          )}
        </View>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.plot}>
          {data.map((d, i) => (
            <Pressable
              key={`${d.label}-${i}`}
              accessibilityRole="button"
              accessibilityLabel={`${d.label}: ${formatSoles(d.value)}`}
              onPress={() => setSelected(i)}
              style={styles.slot}
            >
              <View style={styles.bars}>
                <View
                  style={[
                    styles.bar,
                    { height: Math.max(2, (d.value / max) * CHART_HEIGHT), backgroundColor: color, opacity: selected === null || selected === i ? 1 : 0.45 },
                  ]}
                />
                {two && (
                  <View
                    style={[
                      styles.bar,
                      { height: Math.max(2, ((d.secondary ?? 0) / max) * CHART_HEIGHT), backgroundColor: secondaryColor, opacity: selected === null || selected === i ? 1 : 0.45 },
                    ]}
                  />
                )}
              </View>
              <Text style={styles.axisLabel} numberOfLines={1}>
                {d.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      {two && legend && (
        <View style={styles.legend}>
          <LegendItem color={color} label={legend[0]} />
          {legend[1] && secondaryColor && <LegendItem color={secondaryColor} label={legend[1]} />}
        </View>
      )}
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

// Rampa secuencial de un solo tono (esmeralda), de claro a oscuro.
const RAMP = ['#D1FAE5', '#A7F3D0', '#6EE7B7', '#34D399', '#10B981', '#059669', '#047857', '#065F46'];

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** Mapa de calor: ventas por día de la semana y hora (para saber cuándo reforzar personal). */
export function Heatmap({ matrix, fromHour = 6, toHour = 23 }: { matrix: number[][]; fromHour?: number; toHour?: number }) {
  const [selected, setSelected] = useState<{ d: number; h: number } | null>(null);
  const hours = Array.from({ length: toHour - fromHour }, (_, i) => fromHour + i);
  const max = Math.max(1, ...matrix.flat());
  const shade = (v: number) => (v <= 0 ? colors.background : RAMP[Math.min(RAMP.length - 1, Math.floor((v / max) * RAMP.length))]!);
  const sel = selected ? matrix[selected.d]?.[selected.h] ?? 0 : null;

  return (
    <View style={styles.card}>
      <Text style={styles.readoutValue}>
        {selected ? `${DAYS[selected.d]} ${selected.h}:00 — ${formatSoles(sel ?? 0)} por semana` : 'Toca un cuadro para ver el monto'}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={styles.heatRow}>
            <Text style={styles.dayLabel} />
            {hours.map((h) => (
              <Text key={h} style={styles.hourLabel}>
                {h % 3 === 0 ? h : ''}
              </Text>
            ))}
          </View>
          {matrix.map((row, d) => (
            <View key={d} style={styles.heatRow}>
              <Text style={styles.dayLabel}>{DAYS[d]}</Text>
              {hours.map((h) => (
                <Pressable
                  key={h}
                  accessibilityLabel={`${DAYS[d]} ${h}:00, ${formatSoles(row[h] ?? 0)}`}
                  onPress={() => setSelected({ d, h })}
                  style={[
                    styles.cell,
                    { backgroundColor: shade(row[h] ?? 0) },
                    selected?.d === d && selected.h === h ? { borderColor: colors.text, borderWidth: 2 } : null,
                  ]}
                />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={styles.legend}>
        <Text style={styles.legendText}>Menos</Text>
        {RAMP.map((c) => (
          <View key={c} style={[styles.swatch, { backgroundColor: c }]} />
        ))}
        <Text style={styles.legendText}>Más ventas</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  readout: { minHeight: 56 },
  readoutLabel: { fontSize: font.small, color: colors.textMuted, fontWeight: '700' },
  readoutValue: { fontSize: font.body, color: colors.text, fontWeight: '800' },
  readoutSecondary: { fontSize: font.small, color: colors.textMuted, fontWeight: '700' },
  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingTop: spacing.sm },
  slot: { alignItems: 'center', minWidth: 44 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: CHART_HEIGHT, borderBottomWidth: 1, borderBottomColor: colors.border },
  bar: { width: 14, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  axisLabel: { fontSize: 11, color: colors.textMuted, marginTop: 4, maxWidth: 52 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 14, height: 14, borderRadius: 3 },
  legendText: { fontSize: font.small, color: colors.textMuted, fontWeight: '600' },
  heatRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 2 },
  dayLabel: { width: 34, fontSize: 12, color: colors.textMuted, fontWeight: '700' },
  hourLabel: { width: 22, fontSize: 10, color: colors.textMuted, textAlign: 'center' },
  cell: { width: 22, height: 22, borderRadius: 3, borderWidth: 1, borderColor: colors.surface },
});
