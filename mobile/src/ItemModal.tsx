import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { euro, MenuData, MenuItem, ratingText } from './api';
import { buildItemLine, CartLine, defaultChoice, ItemChoice } from './lines';
import { colors } from './theme';
import { Chip, Stepper } from './ui';

type Props = { menu: MenuData; item: MenuItem; onClose: () => void; onAdd: (line: CartLine) => void };

// Personnalisation d'une pizza : taille, moitié-moitié, suppléments, ingrédients à retirer.
export function ItemModal({ menu, item, onClose, onAdd }: Props) {
  const [choice, setChoice] = useState<ItemChoice>(defaultChoice);
  const [halfOn, setHalfOn] = useState(false);
  const [quantity, setQuantity] = useState(1);

  const otherPizzas = menu.halfAndHalf ? menu.items.filter((i) => i.kind === 'pizza' && i.id !== item.id) : [];
  const ingredients = useMemo(
    () => [...new Set([...item.ingredients, ...(choice.halfItem?.ingredients ?? [])])],
    [item, choice.halfItem],
  );
  const line = buildItemLine(menu, item, choice, quantity);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const setHalf = (half: MenuItem | null) =>
    setChoice((c) => {
      const allowed = [...item.ingredients, ...(half?.ingredients ?? [])];
      return { ...c, halfItem: half, removed: c.removed.filter((r) => allowed.includes(r)) };
    });

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{item.name}</Text>
            <Pressable onPress={onClose} accessibilityLabel="Fermer" hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
          {item.description ? <Text style={styles.muted}>{item.description}</Text> : null}
          {item.rating_count >= 3 && item.rating_avg ? (
            <Text style={styles.rating}>★ {ratingText(item.rating_avg)} · {item.rating_count} avis</Text>
          ) : null}
          {item.allergens.length > 0 && <Text style={styles.allergens}>Allergènes : {item.allergens.join(', ')}</Text>}

          {item.sizes.length > 0 && (
            <>
              <Text style={styles.h}>Taille</Text>
              <View style={styles.wrap}>
                {item.sizes.map((sz, i) => (
                  <Chip
                    key={sz.label}
                    on={choice.sizeIndex === i}
                    label={sz.extra_cents ? `${sz.label} (+${euro(sz.extra_cents)})` : sz.label}
                    onPress={() => setChoice({ ...choice, sizeIndex: i })}
                  />
                ))}
              </View>
            </>
          )}

          {otherPizzas.length > 0 && (
            <>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.h}>Moitié-moitié</Text>
                  <Text style={styles.muted}>Deux pizzas en une (prix de la plus chère)</Text>
                </View>
                <Switch
                  value={halfOn}
                  trackColor={{ true: colors.red }}
                  onValueChange={(v) => {
                    setHalfOn(v);
                    setHalf(v ? otherPizzas[0] : null);
                  }}
                />
              </View>
              {halfOn && (
                <View style={styles.wrap}>
                  {otherPizzas.map((p) => (
                    <Chip key={p.id} on={choice.halfItem?.id === p.id} label={p.name} onPress={() => setHalf(p)} />
                  ))}
                </View>
              )}
            </>
          )}

          {menu.supplements.length > 0 && (
            <>
              <Text style={styles.h}>Suppléments</Text>
              <View style={styles.wrap}>
                {menu.supplements.map((sp) => (
                  <Chip
                    key={sp.id}
                    on={choice.extras.includes(sp.id)}
                    label={`${sp.name} +${euro(sp.price_cents)}`}
                    onPress={() => setChoice({ ...choice, extras: toggle(choice.extras, sp.id) })}
                  />
                ))}
              </View>
            </>
          )}

          {ingredients.length > 0 && (
            <>
              <Text style={styles.h}>Retirer un ingrédient</Text>
              <View style={styles.wrap}>
                {ingredients.map((ing) => (
                  <Chip
                    key={ing}
                    on={choice.removed.includes(ing)}
                    label={choice.removed.includes(ing) ? `Sans ${ing}` : ing}
                    onPress={() => setChoice({ ...choice, removed: toggle(choice.removed, ing) })}
                  />
                ))}
              </View>
            </>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Stepper value={quantity} min={1} onChange={setQuantity} />
          <Pressable
            style={styles.add}
            onPress={() => {
              onAdd(line);
              onClose();
            }}
          >
            <Text style={styles.addText}>Ajouter · {euro(line.unitCents * quantity)}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 26, fontWeight: '800', color: colors.red, flex: 1 },
  close: { fontSize: 24, color: colors.muted, padding: 4 },
  muted: { color: colors.muted, marginTop: 2 },
  rating: { color: '#B97700', fontWeight: '600', marginTop: 6 },
  allergens: { color: colors.muted, fontSize: 13, marginTop: 6 },
  h: { fontSize: 18, fontWeight: '700', color: colors.ink, marginTop: 20, marginBottom: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  add: { flex: 1, backgroundColor: colors.red, borderRadius: 12, padding: 14, alignItems: 'center' },
  addText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
