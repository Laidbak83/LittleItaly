import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { AppConfig, Combo, euro, imageUrl, MenuData, MenuItem, Order } from './api';
import { useCart } from './cart';
import { ComboModal } from './ComboModal';
import { ItemModal } from './ItemModal';
import { buildItemLine, defaultChoice } from './lines';
import { colors } from './theme';
import { Chip } from './ui';

type Row = { kind: 'item'; item: MenuItem } | { kind: 'combo'; combo: Combo };
type Section = { title: string; data: Row[] };

type Props = {
  menu: MenuData | null;
  error: string | null;
  config: AppConfig | null;
  lastOrder: Order | null;
  onReload: () => Promise<void>;
  onReorder: (order: Order) => void;
};

export function MenuScreen({ menu, error, config, lastOrder, onReload, onReorder }: Props) {
  const cart = useCart();
  const [vegOnly, setVegOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [combo, setCombo] = useState<Combo | null>(null);

  // Les pizzas d'abord, puis les formules, puis le reste de la carte.
  const sections = useMemo(() => {
    if (!menu) return [];
    const items = menu.items.filter((i) => !vegOnly || i.vegetarian);
    const cats = [...new Set(items.map((i) => i.category))];
    const comboSection: Section | null =
      !vegOnly && menu.combos.length
        ? { title: 'Formules', data: menu.combos.map((combo) => ({ kind: 'combo' as const, combo })) }
        : null;
    const out: Section[] = [];
    const after = Math.max(cats.indexOf('Pizzas'), 0);
    cats.forEach((title, idx) => {
      out.push({ title, data: items.filter((i) => i.category === title).map((item) => ({ kind: 'item' as const, item })) });
      if (idx === after && comboSection) out.push(comboSection);
    });
    if (!cats.length && comboSection) out.push(comboSection);
    return out;
  }, [menu, vegOnly]);

  if (!menu) {
    return (
      <View style={styles.center}>
        {error ? (
          <>
            <Text style={styles.error}>{error}</Text>
            <Pressable style={styles.retry} onPress={onReload}>
              <Text style={styles.retryText}>Réessayer</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator color={colors.red} size="large" />
        )}
      </View>
    );
  }

  const open = (item: MenuItem) => {
    if (item.kind === 'pizza') setEditing(item);
    else cart.addLine(buildItemLine(menu, item, defaultChoice, 1));
  };

  const header = (
    <View>
      {config && !config.ordersOpen && (
        <Text style={[styles.notice, { backgroundColor: '#555' }]}>Les commandes sont momentanément fermées.</Text>
      )}
      {menu.banner ? <Text style={styles.notice}>{menu.banner}</Text> : null}
      {lastOrder && lastOrder.status !== 'cancelled' && lastOrder.status !== 'pending_payment' && (
        <Pressable style={styles.reorder} onPress={() => onReorder(lastOrder)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.reorderTitle}>↻ Commander à nouveau</Text>
            <Text style={styles.muted} numberOfLines={2}>
              {lastOrder.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}
            </Text>
          </View>
        </Pressable>
      )}
      <View style={styles.filters}>
        <Chip label="🌱 Végétarien" on={vegOnly} onPress={() => setVegOnly(!vegOnly)} />
      </View>
    </View>
  );

  return (
    <>
      <SectionList
        sections={sections}
        keyExtractor={(row) => (row.kind === 'combo' ? `combo-${row.combo.id}` : `item-${row.item.id}`)}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        ListHeaderComponent={header}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await onReload();
              setRefreshing(false);
            }}
          />
        }
        renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
        renderItem={({ item: row }) => {
          if (row.kind === 'combo') {
            const c = row.combo;
            return (
              <Pressable style={[styles.card, styles.comboCard]} onPress={() => setCombo(c)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{c.name}</Text>
                  {c.description ? <Text style={styles.desc}>{c.description}</Text> : null}
                </View>
                <Text style={styles.price}>{euro(c.price_cents)}</Text>
              </Pressable>
            );
          }
          const item = row.item;
          const uri = imageUrl(item.image_url);
          return (
            <Pressable style={styles.card} onPress={() => open(item)} accessibilityLabel={item.name}>
              {uri ? (
                <Image source={{ uri }} style={styles.photo} />
              ) : (
                <View style={[styles.photo, styles.photoPlaceholder]}>
                  <Text style={{ fontSize: 28 }}>{item.kind === 'pizza' ? '🍕' : item.kind === 'boisson' ? '🥤' : item.kind === 'dessert' ? '🍰' : '🍽️'}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>
                  {item.name} {item.vegetarian && item.kind === 'pizza' ? '🌱' : ''}
                </Text>
                {item.description ? <Text style={styles.desc}>{item.description}</Text> : null}
                {item.allergens.length > 0 && <Text style={styles.allergens}>Allergènes : {item.allergens.join(', ')}</Text>}
                <Text style={styles.price}>{item.sizes.length ? 'dès ' : ''}{euro(item.price_cents)}</Text>
              </View>
              <View style={[styles.addBtn]}>
                <Text style={styles.addText}>{item.kind === 'pizza' ? '›' : '+'}</Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text style={styles.muted}>Rien à afficher avec ce filtre.</Text>}
      />
      {editing && (
        <ItemModal menu={menu} item={editing} onClose={() => setEditing(null)} onAdd={cart.addLine} />
      )}
      {combo && <ComboModal menu={menu} combo={combo} onClose={() => setCombo(null)} onAdd={cart.addLine} />}
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: colors.ink, textAlign: 'center', marginBottom: 12 },
  retry: { backgroundColor: colors.red, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  retryText: { color: '#fff', fontWeight: '600' },
  notice: { backgroundColor: colors.red, color: '#fff', fontWeight: '700', padding: 12, borderRadius: 10, marginBottom: 12, overflow: 'hidden' },
  reorder: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.red },
  reorderTitle: { fontWeight: '700', color: colors.red, fontSize: 16, marginBottom: 2 },
  filters: { flexDirection: 'row', marginTop: 12 },
  section: { fontSize: 22, fontWeight: '700', color: colors.red, marginTop: 16, marginBottom: 8, backgroundColor: colors.bg },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  comboCard: { borderColor: colors.red },
  photo: { width: 72, height: 72, borderRadius: 10 },
  photoPlaceholder: { backgroundColor: '#f1ebe0', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 17, fontWeight: '600', color: colors.ink },
  desc: { color: colors.muted, marginTop: 2 },
  allergens: { color: colors.muted, fontSize: 12, marginTop: 2 },
  muted: { color: colors.muted },
  price: { marginTop: 6, fontWeight: '600', color: colors.ink },
  addBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
  addText: { color: '#fff', fontSize: 22, lineHeight: 26, fontWeight: '600' },
});
