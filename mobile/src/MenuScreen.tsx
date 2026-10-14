import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { AppConfig, Combo, euro, frDate, imageUrl, Loyalty, MenuData, MenuItem, Order, ratingText } from './api';
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
  loyalty: Loyalty | null;
  lastOrder: Order | null;
  onReload: () => Promise<void>;
  onReorder: (order: Order) => void;
  onRate: () => void;
};

export function MenuScreen({ menu, error, config, loyalty, lastOrder, onReload, onReorder, onRate }: Props) {
  const cart = useCart();
  const [vegOnly, setVegOnly] = useState(false);
  const [avoid, setAvoid] = useState<string[]>([]); // allergènes à éviter
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [combo, setCombo] = useState<Combo | null>(null);

  // Les pizzas d'abord, puis les formules, puis le reste de la carte.
  const sections = useMemo(() => {
    if (!menu) return [];
    const items = menu.items.filter((i) => (!vegOnly || i.vegetarian) && !i.allergens.some((a) => avoid.includes(a)));
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
  }, [menu, vegOnly, avoid]);

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

  const featuredItem = menu.featured ? menu.items.find((i) => i.id === menu.featured!.itemId) ?? null : null;
  const showFeatured = featuredItem && (!vegOnly || featuredItem.vegetarian) ? featuredItem : null;
  const bestSellers = menu.bestSellers
    .map((id) => menu.items.find((i) => i.id === id))
    .filter((i): i is MenuItem => !!i && (!vegOnly || i.vegetarian));
  const toRate = !!lastOrder && lastOrder.status === 'done' && (lastOrder.rateable?.length ?? 0) > (lastOrder.ratings?.length ?? 0);

  const open = (item: MenuItem) => {
    if (item.sold_out) return;
    if (item.kind === 'pizza') setEditing(item);
    else cart.addLine(buildItemLine(menu, item, defaultChoice, 1));
  };
  const allergens = [...new Set(menu.items.flatMap((i) => i.allergens))].sort();
  const nextClosure = config?.closures[0];

  const header = (
    <View>
      {config && !config.ordersOpen && (
        <Text style={[styles.notice, { backgroundColor: '#555' }]}>Les commandes sont momentanément fermées.</Text>
      )}
      {nextClosure && (
        <Text style={[styles.notice, { backgroundColor: '#555' }]}>
          Fermé {nextClosure.date_from === nextClosure.date_to ? frDate(nextClosure.date_from) : `du ${frDate(nextClosure.date_from)} au ${frDate(nextClosure.date_to)}`}
          {nextClosure.reason ? ` · ${nextClosure.reason}` : ''}
        </Text>
      )}
      {loyalty?.welcome && (
        <Text style={[styles.notice, { backgroundColor: colors.green }]}>
          🎁 −{euro(loyalty.welcome.cents)} sur votre première commande (dès {euro(loyalty.welcome.min_cents)})
        </Text>
      )}
      {menu.banner ? <Text style={styles.notice}>{menu.banner}</Text> : null}
      {toRate && (
        <Pressable style={styles.rateCard} onPress={onRate}>
          <Text style={styles.rateTitle}>⭐ Comment était votre dernière commande ?</Text>
          <Text style={styles.muted}>Notez vos pizzas en 10 secondes.</Text>
        </Pressable>
      )}
      {showFeatured && (
        <Pressable style={styles.featured} onPress={() => open(showFeatured)} accessibilityLabel={`Pizza de la semaine : ${showFeatured.name}`}>
          <Text style={styles.featuredTag}>⭐ PIZZA DE LA SEMAINE</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.featuredName}>{showFeatured.name}</Text>
              <Text style={styles.featuredDesc}>{showFeatured.description}</Text>
              {menu.featured?.note ? <Text style={styles.featuredNote}>{menu.featured.note}</Text> : null}
              {menu.featured?.until ? <Text style={styles.featuredDesc}>Jusqu'au {frDate(menu.featured.until)}</Text> : null}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {showFeatured.regular_price_cents ? <Text style={styles.strike}>{euro(showFeatured.regular_price_cents)}</Text> : null}
              <Text style={styles.featuredPrice}>{euro(showFeatured.price_cents)}</Text>
            </View>
          </View>
        </Pressable>
      )}
      {bestSellers.length > 0 && (
        <View style={{ marginBottom: 4 }}>
          <Text style={styles.section}>🔥 Les plus commandées</Text>
          <View style={styles.bestRow}>
            {bestSellers.map((it) => (
              <Pressable key={it.id} style={styles.bestCard} onPress={() => open(it)} accessibilityLabel={`${it.name}, best-seller`}>
                <Text style={styles.bestName} numberOfLines={1}>{it.name}</Text>
                <Text style={styles.price}>{euro(it.price_cents)}</Text>
                {it.rating_count >= 3 && it.rating_avg ? <Text style={styles.rating}>★ {ratingText(it.rating_avg)}</Text> : null}
              </Pressable>
            ))}
          </View>
        </View>
      )}
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
      {allergens.length > 0 && (
        <View style={{ marginTop: 10 }}>
          <Text style={styles.muted}>Éviter :</Text>
          <View style={[styles.filters, { flexWrap: 'wrap', gap: 6, marginTop: 4 }]}>
            {allergens.map((a) => (
              <Chip key={a} label={a} on={avoid.includes(a)} onPress={() => setAvoid(avoid.includes(a) ? avoid.filter((x) => x !== a) : [...avoid, a])} />
            ))}
          </View>
          {avoid.length > 0 && <Text style={styles.allergens}>Selon les informations renseignées par le restaurant. En cas d'allergie, prévenez-nous lors de la commande.</Text>}
        </View>
      )}
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
            <Pressable style={[styles.card, item.sold_out && { opacity: 0.55 }]} onPress={() => open(item)} disabled={item.sold_out} accessibilityLabel={item.name}>
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
                  {menu.bestSellers.includes(item.id) ? '🔥' : ''}
                </Text>
                {item.description ? <Text style={styles.desc}>{item.description}</Text> : null}
                {item.allergens.length > 0 && <Text style={styles.allergens}>Allergènes : {item.allergens.join(', ')}</Text>}
                {item.rating_count >= 3 && item.rating_avg ? (
                  <Text style={styles.rating}>★ {ratingText(item.rating_avg)} <Text style={styles.muted}>({item.rating_count} avis)</Text></Text>
                ) : null}
                <Text style={styles.price}>
                  {item.sizes.length ? 'dès ' : ''}
                  {euro(item.price_cents)}
                  {item.regular_price_cents ? <Text style={styles.strikeDark}>  {euro(item.regular_price_cents)}</Text> : null}
                </Text>
              </View>
              {item.sold_out ? (
                <Text style={styles.soldOut}>Épuisé aujourd'hui</Text>
              ) : (
                <View style={[styles.addBtn]}>
                  <Text style={styles.addText}>{item.kind === 'pizza' ? '›' : '+'}</Text>
                </View>
              )}
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
  rateCard: { backgroundColor: '#fff8e6', borderColor: '#f0d98a', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 },
  rateTitle: { fontWeight: '700', fontSize: 16, color: colors.ink, marginBottom: 2 },
  featured: { backgroundColor: colors.red, borderRadius: 14, padding: 16, marginBottom: 12 },
  featuredTag: { color: '#F6C453', fontWeight: '800', fontSize: 12, letterSpacing: 1, marginBottom: 6 },
  featuredName: { color: '#fff', fontSize: 24, fontWeight: '800' },
  featuredDesc: { color: '#ffffffd9', marginTop: 2 },
  featuredNote: { color: '#F6C453', fontWeight: '600', marginTop: 4 },
  featuredPrice: { color: '#fff', fontSize: 26, fontWeight: '800' },
  strike: { color: '#ffffffb3', textDecorationLine: 'line-through', fontSize: 14 },
  strikeDark: { color: colors.muted, textDecorationLine: 'line-through', fontWeight: '400' },
  bestRow: { flexDirection: 'row', gap: 8 },
  bestCard: { flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.line },
  bestName: { fontWeight: '700', fontSize: 15, color: colors.ink },
  rating: { color: '#B97700', fontWeight: '600', fontSize: 13, marginTop: 2 },
  soldOut: { color: colors.muted, fontWeight: '700', fontSize: 12, maxWidth: 70, textAlign: 'center' },
  addBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
  addText: { color: '#fff', fontSize: 22, lineHeight: 26, fontWeight: '600' },
});
