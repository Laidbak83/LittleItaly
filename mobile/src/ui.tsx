import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, on && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={on ? s.chipOnText : s.chipText}>{label}</Text>
    </Pressable>
  );
}

export function Stepper({ value, onChange, min = 0 }: { value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <View style={s.stepper}>
      <Pressable accessibilityLabel="Moins" style={s.round} onPress={() => onChange(Math.max(min, value - 1))}>
        <Text style={s.roundText}>−</Text>
      </Pressable>
      <Text style={s.qty}>{value}</Text>
      <Pressable accessibilityLabel="Plus" style={[s.round, s.roundAdd]} onPress={() => onChange(Math.min(20, value + 1))}>
        <Text style={[s.roundText, { color: '#fff' }]}>+</Text>
      </Pressable>
    </View>
  );
}

export const s = StyleSheet.create({
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.red, borderColor: colors.red },
  chipText: { color: colors.ink },
  chipOnText: { color: '#fff', fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  round: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  roundAdd: { backgroundColor: colors.red, borderColor: colors.red },
  roundText: { fontSize: 22, lineHeight: 26, color: colors.ink },
  qty: { minWidth: 30, textAlign: 'center', fontWeight: '700', fontSize: 16 },
});

// Cinq étoiles tactiles (ou en lecture seule si onChange est absent).
export function Stars({ value, onChange, size = 30 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          disabled={!onChange}
          hitSlop={6}
          onPress={() => onChange?.(n)}
          accessibilityRole={onChange ? 'button' : 'image'}
          accessibilityLabel={`${n} étoile${n > 1 ? 's' : ''} sur 5`}
        >
          <Text style={{ fontSize: size, color: n <= value ? '#F6A800' : '#D8D2C6' }}>★</Text>
        </Pressable>
      ))}
    </View>
  );
}
