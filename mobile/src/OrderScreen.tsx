import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { euro, getOrder, Order, OrderStatus } from './api';
import { colors } from './theme';

const STEPS: { status: OrderStatus; label: string }[] = [
  { status: 'new', label: 'Commande reçue' },
  { status: 'preparing', label: 'En préparation' },
  { status: 'ready', label: 'Prête à retirer !' },
];
const rank = (s: OrderStatus) => STEPS.findIndex((x) => x.status === s);

type Props = { orderId: string | null; onReorder: (order: Order) => void; onOrderChange?: (order: Order) => void };

export function OrderScreen({ orderId, onReorder, onOrderChange }: Props) {
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const o = await getOrder(orderId);
        if (!stopped) {
          setOrder(o);
          setError(null);
          onOrderChange?.(o);
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  if (!orderId) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Aucune commande en cours.</Text>
      </View>
    );
  }
  if (!order) {
    return (
      <View style={styles.center}>
        {error ? <Text style={styles.muted}>{error}</Text> : <ActivityIndicator color={colors.red} size="large" />}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.title}>Commande n°{order.number}</Text>
      <Text style={styles.sub}>Retrait à {order.pickup_time}</Text>

      {order.status === 'cancelled' ? (
        <Text style={[styles.banner, { backgroundColor: '#555' }]}>Commande annulée</Text>
      ) : order.status === 'pending_payment' ? (
        <Text style={[styles.banner, { backgroundColor: colors.muted }]}>Validation du paiement…</Text>
      ) : order.status === 'done' ? (
        <Text style={[styles.banner, { backgroundColor: colors.muted }]}>Commande retirée. Bon appétit ! 🍕</Text>
      ) : (
        STEPS.map((s, i) => {
          const reached = rank(order.status) >= i;
          return (
            <View key={s.status} style={styles.step}>
              <View style={[styles.dot, reached && { backgroundColor: i === 2 ? colors.green : colors.red }]} />
              <Text style={[styles.stepText, reached && { color: colors.ink, fontWeight: '700' }]}>{s.label}</Text>
            </View>
          );
        })
      )}

      <View style={styles.card}>
        {order.items.map((it, i) => (
          <View key={i} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text>{it.quantity} × {it.name}</Text>
              {it.details ? <Text style={styles.small}>{it.details}</Text> : null}
            </View>
            <Text>{euro(it.quantity * it.unit_price_cents)}</Text>
          </View>
        ))}
        {order.discount_cents > 0 && (
          <View style={styles.row}>
            <Text style={{ flex: 1, color: colors.green }}>🎁 Pizza offerte</Text>
            <Text style={{ color: colors.green }}>−{euro(order.discount_cents)}</Text>
          </View>
        )}
        <View style={[styles.row, { borderTopWidth: 1, borderColor: colors.line, paddingTop: 8 }]}>
          <Text style={[styles.bold, { flex: 1 }]}>Total</Text>
          <Text style={styles.bold}>{euro(order.total_cents)}</Text>
        </View>
        <Text style={styles.muted}>
          {order.total_cents === 0 ? '' : order.payment_status === 'paid' ? '✅ Payé en ligne' : '💶 À régler au retrait'}
        </Text>
      </View>

      <Pressable style={styles.reorder} onPress={() => onReorder(order)}>
        <Text style={styles.reorderText}>↻ Commander à nouveau</Text>
      </Pressable>
      <Text style={[styles.muted, { marginTop: 16 }]}>Little Italy · Trans-en-Provence</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 26, fontWeight: '800', color: colors.red },
  sub: { fontSize: 17, color: colors.ink, marginBottom: 16 },
  banner: { color: '#fff', padding: 14, borderRadius: 10, fontWeight: '700', marginBottom: 16, overflow: 'hidden' },
  step: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.line, marginRight: 12 },
  stepText: { fontSize: 17, color: colors.muted },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginVertical: 16, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', paddingVertical: 4, gap: 8 },
  bold: { fontWeight: '700' },
  muted: { color: colors.muted },
  small: { color: colors.muted, fontSize: 13 },
  reorder: { borderWidth: 1, borderColor: colors.red, borderRadius: 12, padding: 14, alignItems: 'center' },
  reorderText: { color: colors.red, fontWeight: '700', fontSize: 16 },
});
