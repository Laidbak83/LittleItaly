import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Combo, euro, Kind, MenuData, MenuItem } from './api';
import { buildComboLine, CartLine } from './lines';
import { colors } from './theme';
import { Chip } from './ui';

const KIND_LABEL: Record<Kind, string> = { pizza: 'Votre pizza', boisson: 'Votre boisson', dessert: 'Votre dessert', autre: 'Votre choix' };
type Props = { menu: MenuData; combo: Combo; onClose: () => void; onAdd: (line: CartLine) => void };

// Une formule = un article à choisir pour chaque emplacement (pizza, boisson, dessert…).
export function ComboModal({ menu, combo, onClose, onAdd }: Props) {
  const [picks, setPicks] = useState<(MenuItem | null)[]>(combo.slots.map(() => null));
  const complete = picks.every(Boolean);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{combo.name}</Text>
            <Pressable onPress={onClose} accessibilityLabel="Fermer" hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
          {combo.description ? <Text style={styles.muted}>{combo.description}</Text> : null}
          {combo.slots.map((kind, i) => (
            <View key={i}>
              <Text style={styles.h}>{KIND_LABEL[kind]}</Text>
              <View style={styles.wrap}>
                {menu.items
                  .filter((it) => it.kind === kind)
                  .map((it) => (
                    <Chip
                      key={it.id}
                      on={picks[i]?.id === it.id}
                      label={it.name}
                      onPress={() => setPicks(picks.map((p, j) => (j === i ? it : p)))}
                    />
                  ))}
              </View>
            </View>
          ))}
        </ScrollView>
        <View style={styles.footer}>
          <Pressable
            style={[styles.add, !complete && { opacity: 0.5 }]}
            disabled={!complete}
            onPress={() => {
              onAdd(buildComboLine(menu, combo, picks as MenuItem[], 1));
              onClose();
            }}
          >
            <Text style={styles.addText}>Ajouter · {euro(combo.price_cents)}</Text>
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
  h: { fontSize: 18, fontWeight: '700', color: colors.ink, marginTop: 20, marginBottom: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  footer: { padding: 16, borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  add: { backgroundColor: colors.red, borderRadius: 12, padding: 14, alignItems: 'center' },
  addText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
