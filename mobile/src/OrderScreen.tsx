import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { showAlert } from './alert';
import { AppConfig, euro, getOrder, Order, OrderStatus, sendArrival } from './api';
import { RatingCard } from './RatingCard';
import { colors } from './theme';

// Suivi de commande façon « pizza tracker » : 4 étapes, compte à rebours, bouton « J'arrive ».
const STEPS: { status: OrderStatus; icon: string; label: string }[] = [
  { status: 'new', icon: '📩', label: 'Reçue' },
  { status: 'preparing', icon: '👨‍🍳', label: 'Acceptée' },
  { status: 'ready', icon: '🍕', label: 'Prête' },
  { status: 'done', icon: '😋', label: 'Retirée' },
];
const rank = (s: OrderStatus) => STEPS.findIndex((x) => x.status === s);

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayText = (o: Order) =>
  o.pickup_in_days <= 0
    ? ''
    : o.pickup_in_days === 1
      ? 'Demain '
      : `${new Date(`${o.pickup_date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} `;
const duration = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`);

type Props = { orderId: string | null; config: AppConfig | null; onReorder: (order: Order) => void; onOrderChange?: (order: Order) => void };

export function OrderScreen({ orderId, config, onReorder, onOrderChange }: Props) {
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [arriving, setArriving] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  const reload = useRef<() => Promise<void>>(async () => {});
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
    reload.current = tick;
    tick();
    const t = setInterval(() => {
      tick();
      setNow(Date.now());
    }, 5000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const step = order ? Math.max(rank(order.status), 0) : 0;
  useEffect(() => {
    Animated.timing(progress, { toValue: step / (STEPS.length - 1), duration: 600, useNativeDriver: false }).start();
  }, [step, progress]);

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

  const active = order.status === 'new' || order.status === 'preparing' || order.status === 'ready';
  const minutesLeft = Math.round((Date.parse(order.pickup_at) - now) / 60000);

  async function arrive(minutes: 0 | 5 | 10 | 15 | 20) {
    setArriving(true);
    try {
      setOrder(await sendArrival(order!.id, minutes));
    } catch (e) {
      showAlert('Erreur', (e as Error).message);
    } finally {
      setArriving(false);
    }
  }

  const headline =
    order.status === 'cancelled'
      ? 'Commande annulée'
      : order.status === 'pending_payment'
        ? 'Validation du paiement…'
        : order.status === 'done'
          ? 'Commande retirée. Bon appétit ! 🍕'
          : order.status === 'ready'
            ? 'Votre commande est prête ! 🍕'
            : minutesLeft > 0 && order.pickup_in_days === 0
              ? `Retrait dans environ ${duration(minutesLeft)}`
              : order.pickup_in_days > 0
                ? 'Commande enregistrée'
                : 'Elle arrive tout de suite';

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.title}>Commande n°{order.number}</Text>
      <Text style={styles.sub}>Retrait {dayText(order)}à {order.pickup_time}</Text>

      {order.status === 'cancelled' || order.status === 'pending_payment' ? (
        <Text style={[styles.banner, { backgroundColor: order.status === 'cancelled' ? '#555' : colors.muted }]}>{headline}</Text>
      ) : (
        <View style={styles.tracker}>
          <Text style={styles.headline}>{headline}</Text>
          <View style={styles.bar}>
            <View style={styles.track} />
            <Animated.View style={[styles.fill, { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
            <View style={styles.dots}>
              {STEPS.map((s, i) => (
                <View key={s.status} style={[styles.dot, i <= step && styles.dotOn, i === step && styles.dotNow]}>
                  <Text style={{ fontSize: 20, opacity: i <= step ? 1 : 0.35 }}>{s.icon}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.labels}>
            {STEPS.map((s, i) => (
              <Text key={s.status} style={[styles.stepLabel, i <= step && { color: colors.ink, fontWeight: '700' }]}>{s.label}</Text>
            ))}
          </View>
        </View>
      )}

      {active && (
        <View style={[styles.arrive, order.hold_until_arrival && styles.arriveHold]}>
          <Text style={styles.arriveTitle}>
            {order.arrival_here
              ? '📍 Merci, nous savons que vous êtes là !'
              : order.hold_until_arrival
                ? '🚶 Dites-nous quand vous partez'
                : '🚶 Vous êtes en route ?'}
          </Text>
          <Text style={styles.muted}>
            {order.arrival_here
              ? 'Votre commande vous attend au comptoir.'
              : order.arrival_eta_at
                ? `Prévenu : arrivée vers ${hhmm(order.arrival_eta_at)}. Vous pouvez mettre à jour.`
                : order.hold_until_arrival
                  ? 'Nous lançons votre pizza à ce moment-là pour qu\'elle soit bien chaude.'
                  : 'Prévenez-nous : la cuisine cale la cuisson sur votre arrivée.'}
          </Text>
          {!order.arrival_here && (
            <View style={styles.wrap}>
              {order.status !== 'ready' &&
                ([5, 10, 15] as const).map((m) => (
                  <Pressable key={m} style={styles.arriveBtn} disabled={arriving} onPress={() => arrive(m)}>
                    <Text style={styles.arriveBtnText}>Dans {m} min</Text>
                  </Pressable>
                ))}
              <Pressable style={[styles.arriveBtn, styles.arriveBtnHere]} disabled={arriving} onPress={() => arrive(0)}>
                <Text style={[styles.arriveBtnText, { color: '#fff' }]}>Je suis là</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {order.status === 'done' && <RatingCard order={order} reviewUrl={config?.info.reviewUrl} onDone={() => reload.current()} />}

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
        {order.discount_cents > 0 && <DiscountRow label="🎁 Pizza offerte" cents={order.discount_cents} />}
        {order.welcome_discount_cents > 0 && <DiscountRow label="🎁 Offre de bienvenue" cents={order.welcome_discount_cents} />}
        {order.offer_discount_cents > 0 && <DiscountRow label={`🕑 Offre ${order.offer_label ?? ''}`} cents={order.offer_discount_cents} />}
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
      {config?.info.phone ? (
        <Pressable onPress={() => Linking.openURL(`tel:${config.info.phone.replace(/\s/g, '')}`)}>
          <Text style={[styles.link, { marginTop: 14 }]}>📞 Appeler le restaurant</Text>
        </Pressable>
      ) : null}
      <Text style={[styles.muted, { marginTop: 14 }]}>Little Italy · Trans-en-Provence</Text>
    </ScrollView>
  );
}

function DiscountRow({ label, cents }: { label: string; cents: number }) {
  return (
    <View style={styles.row}>
      <Text style={{ flex: 1, color: colors.green }}>{label}</Text>
      <Text style={{ color: colors.green }}>−{euro(cents)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 26, fontWeight: '800', color: colors.red },
  sub: { fontSize: 17, color: colors.ink, marginBottom: 14 },
  banner: { color: '#fff', padding: 14, borderRadius: 10, fontWeight: '700', marginBottom: 16, overflow: 'hidden' },
  tracker: { backgroundColor: colors.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.line, marginBottom: 14 },
  headline: { fontSize: 19, fontWeight: '800', color: colors.ink, marginBottom: 16 },
  bar: { height: 44, justifyContent: 'center' },
  track: { position: 'absolute', left: 22, right: 22, height: 6, borderRadius: 3, backgroundColor: colors.line },
  fill: { position: 'absolute', left: 22, height: 6, borderRadius: 3, backgroundColor: colors.red, maxWidth: '88%' },
  dots: { flexDirection: 'row', justifyContent: 'space-between' },
  dot: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, borderWidth: 2, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  dotOn: { borderColor: colors.red, backgroundColor: '#fdecee' },
  dotNow: { borderWidth: 3 },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  stepLabel: { width: 60, textAlign: 'center', fontSize: 12, color: colors.muted },
  arrive: { backgroundColor: '#fff8e6', borderColor: '#f0d98a', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 14 },
  arriveHold: { backgroundColor: '#eef3fb', borderColor: '#b8c8ea', borderWidth: 2 },
  arriveTitle: { fontWeight: '800', fontSize: 16, color: colors.ink, marginBottom: 2 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  arriveBtn: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  arriveBtnHere: { backgroundColor: colors.green, borderColor: colors.green },
  arriveBtnText: { fontWeight: '700', color: colors.ink },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginVertical: 14, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', paddingVertical: 4, gap: 8 },
  bold: { fontWeight: '700' },
  muted: { color: colors.muted },
  small: { color: colors.muted, fontSize: 13 },
  link: { color: colors.red, fontWeight: '700', textAlign: 'center' },
  reorder: { borderWidth: 1, borderColor: colors.red, borderRadius: 12, padding: 14, alignItems: 'center' },
  reorderText: { color: colors.red, fontWeight: '700', fontSize: 16 },
});
