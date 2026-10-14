import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { euro, getMenu, MenuItem } from './api';
import { useCart } from './cart';
import { colors } from './theme';

export function MenuScreen() {
  const { lines, add, remove } = useCart();
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await getMenu());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!items) {
    return (
      <View style={styles.center}>
        {error ? (
          <>
            <Text style={styles.error}>{error}</Text>
            <Pressable style={styles.retry} onPress={load}>
              <Text style={styles.retryText}>Réessayer</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator color={colors.red} size="large" />
        )}
      </View>
    );
  }

  const sections = [...new Set(items.map((i) => i.category))].map((title) => ({
    title,
    data: items.filter((i) => i.category === title),
  }));
  const qty = (id: number) => lines.find((l) => l.item.id === id)?.quantity ?? 0;

  return (
    <SectionList
      sections={sections}
      keyExtractor={(i) => String(i.id)}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.name}</Text>
            {item.description ? <Text style={styles.desc}>{item.description}</Text> : null}
            <Text style={styles.price}>{euro(item.price_cents)}</Text>
          </View>
          <View style={styles.stepper}>
            {qty(item.id) > 0 && (
              <>
                <Pressable accessibilityLabel={`Retirer ${item.name}`} style={styles.btn} onPress={() => remove(item)}>
                  <Text style={styles.btnText}>−</Text>
                </Pressable>
                <Text style={styles.qty}>{qty(item.id)}</Text>
              </>
            )}
            <Pressable accessibilityLabel={`Ajouter ${item.name}`} style={[styles.btn, styles.btnAdd]} onPress={() => add(item)}>
              <Text style={[styles.btnText, { color: '#fff' }]}>+</Text>
            </Pressable>
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: colors.ink, textAlign: 'center', marginBottom: 12 },
  retry: { backgroundColor: colors.red, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  retryText: { color: '#fff', fontWeight: '600' },
  section: { fontSize: 22, fontWeight: '700', color: colors.red, marginTop: 16, marginBottom: 8, backgroundColor: colors.bg },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  name: { fontSize: 17, fontWeight: '600', color: colors.ink },
  desc: { color: colors.muted, marginTop: 2 },
  price: { marginTop: 6, fontWeight: '600', color: colors.ink },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  btn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  btnAdd: { backgroundColor: colors.red, borderColor: colors.red },
  btnText: { fontSize: 22, lineHeight: 26, color: colors.ink },
  qty: { minWidth: 28, textAlign: 'center', fontWeight: '700', fontSize: 16 },
});
