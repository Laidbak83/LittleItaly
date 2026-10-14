import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { showAlert } from './alert';
import { AppConfig, createOrder, dayLabel, euro, getQuote, getSlots, Loyalty, MenuData, PaymentMethod, Quote, Slots } from './api';
import { useCart } from './cart';
import { buildItemLine, defaultChoice } from './lines';
import { getPushToken } from './push';
import { loadSaved, Saved, saveSaved } from './storage';
import { initPaymentSheet, presentPaymentSheet } from './stripe';
import { colors } from './theme';
import { Chip, Stepper } from './ui';

type Props = {
  menu: MenuData | null;
  config: AppConfig | null;
  loyalty: Loyalty | null;
  loyaltyId: string;
  onOrdered: (orderId: string) => void;
};

export function CartScreen({ menu, config, loyalty, loyaltyId, onOrdered }: Props) {
  const cart = useCart();
  const [slots, setSlots] = useState<Slots | null>(null);
  const [chosenDate, setChosenDate] = useState<string | null>(null); // null = aujourd'hui
  const [pickupTime, setPickupTime] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('on_pickup');
  const [useReward, setUseReward] = useState(false);
  const [referral, setReferral] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadSaved().then((s) => {
      setName(s.name);
      setPhone(s.phone);
    });
  }, []);

  const pizzas = cart.pizzaCount;
  const cartKey = cart.lines.map((l) => l.key + l.quantity).join('|');
  const online = !!config?.onlinePaymentEnabled && Platform.OS !== 'web';

  // Créneaux du jour choisi (aujourd'hui par défaut).
  useEffect(() => {
    if (cart.count === 0) return;
    setSlots(null);
    getSlots(pizzas, chosenDate ?? undefined)
      .then((r) => {
        setSlots(r);
        setPickupTime((t) => (t && r.slots.includes(t) ? t : null));
      })
      .catch(() => setSlots({ date: chosenDate ?? '', slots: [], maxPizzasPerSlot: 0, offers: {}, closed: null, days: [] }));
  }, [pizzas, chosenDate, cart.count === 0]);

  const eligible = cart.lines.filter((l) => l.rewardEligible);
  const canUseReward = (loyalty?.rewardsAvailable ?? 0) > 0 && eligible.length > 0;
  useEffect(() => {
    if (!canUseReward) setUseReward(false);
  }, [canUseReward]);

  // Devis : le serveur calcule le total exact (pizza offerte, bienvenue, heures creuses…).
  const phoneOk = phone.replace(/\D/g, '').length >= 10;
  useEffect(() => {
    if (cart.count === 0) return;
    let stale = false;
    const t = setTimeout(() => {
      getQuote({
        items: cart.lines.map((l) => l.config),
        pickupTime: pickupTime ?? undefined,
        pickupDate: chosenDate ?? undefined,
        loyaltyId,
        useReward: useReward && canUseReward,
        phone: phoneOk ? phone : undefined,
        referralCode: referral.trim() || undefined,
      })
        .then((q) => !stale && (setQuote(q), setQuoteError(null)))
        .catch((e: Error) => !stale && (setQuote(null), setQuoteError(e.message)));
    }, 300);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [cartKey, pickupTime, chosenDate, useReward, canUseReward, referral, phoneOk, phoneOk ? phone : '', loyaltyId]);

  // « Il manque une boisson ? » : suggestions rapides quand le panier contient une pizza.
  const suggestions = useMemo(() => {
    if (!menu || pizzas === 0) return [];
    const has = (k: string) => cart.lines.some((l) => l.kinds.includes(k as never));
    const out = [];
    if (!has('boisson')) out.push(...menu.items.filter((i) => i.kind === 'boisson' && !i.sold_out).slice(0, 3));
    if (!has('dessert')) out.push(...menu.items.filter((i) => i.kind === 'dessert' && !i.sold_out).slice(0, 2));
    return out;
  }, [menu, pizzas, cart.lines]);

  if (cart.count === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>Votre panier est vide 🍕</Text>
      </View>
    );
  }

  const today = slots?.days[0]?.date ?? '';
  const selectedDate = chosenDate ?? today;
  const mustPayOnline = quote?.requires_online ?? false;
  const effectiveMethod: PaymentMethod = mustPayOnline ? 'online' : method;
  const total = quote?.total_cents ?? cart.subtotalCents;
  const free = quote !== null && total === 0;
  const blockedOnline = mustPayOnline && !online;
  const closed = config ? !config.ordersOpen && selectedDate === today : false;
  const valid = !closed && !!quote && !blockedOnline && name.trim().length >= 2 && phoneOk && !!pickupTime;
  const firstOrderOffer = loyalty?.welcome ?? null;

  async function submit() {
    if (!valid || !pickupTime) return;
    setBusy(true);
    try {
      const payOnline = effectiveMethod === 'online' && !free;
      const { order, clientSecret } = await createOrder({
        customerName: name.trim(),
        phone,
        note,
        pickupTime,
        pickupDate: chosenDate ?? undefined,
        paymentMethod: free ? 'on_pickup' : effectiveMethod,
        pushToken: await getPushToken(),
        loyaltyId,
        useReward: useReward && canUseReward,
        referralCode: referral.trim() || undefined,
        items: cart.lines.map((l) => l.config),
      });

      if (payOnline) {
        if (!clientSecret) throw new Error('Paiement indisponible');
        const init = await initPaymentSheet({
          merchantDisplayName: 'Little Italy',
          paymentIntentClientSecret: clientSecret,
          allowsDelayedPaymentMethods: false,
        });
        if (init.error) throw new Error(init.error.message);
        const result = await presentPaymentSheet();
        if (result.error) {
          // Commande non payée : elle reste invisible pour le restaurant.
          showAlert('Paiement non finalisé', "Votre commande n'a pas été envoyée. Vous pouvez réessayer.");
          return;
        }
      }
      const saved: Saved = { ...(await loadSaved()), name: name.trim(), phone, lastOrderId: order.id };
      await saveSaved(saved);
      cart.clear();
      setUseReward(false);
      setReferral('');
      onOrdered(order.id);
    } catch (e) {
      showAlert('Erreur', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.h}>Votre commande</Text>
        {cart.lines.map((l) => (
          <View key={l.key} style={styles.line}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lineName}>{l.label}</Text>
              {l.details ? <Text style={styles.muted}>{l.details}</Text> : null}
              <Text style={styles.muted}>{euro(l.unitCents)}</Text>
            </View>
            <Stepper value={l.quantity} onChange={(q) => cart.setQuantity(l.key, q)} />
          </View>
        ))}

        {suggestions.length > 0 && menu && (
          <View style={styles.suggest}>
            <Text style={styles.suggestTitle}>Un petit extra ?</Text>
            <View style={styles.wrap}>
              {suggestions.map((it) => (
                <Pressable key={it.id} style={styles.suggestChip} onPress={() => cart.addLine(buildItemLine(menu, it, defaultChoice, 1))}>
                  <Text>+ {it.name} · {euro(it.price_cents)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {canUseReward && (
          <View style={styles.reward}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rewardTitle}>🎁 Vous avez une pizza offerte !</Text>
              <Text style={styles.muted}>La moins chère de votre commande est offerte ({euro(Math.min(...eligible.map((l) => l.unitCents)))}).</Text>
            </View>
            <Switch value={useReward} onValueChange={setUseReward} trackColor={{ true: colors.red }} />
          </View>
        )}

        {firstOrderOffer && (
          <View style={styles.reward}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rewardTitle}>🎁 Première commande : −{euro(firstOrderOffer.cents)}</Text>
              <Text style={styles.muted}>Offert dès {euro(firstOrderOffer.min_cents)} de commande, appliqué automatiquement.</Text>
            </View>
          </View>
        )}
        {firstOrderOffer && config?.referral && (
          <TextInput style={styles.input} placeholder="Code ami (facultatif)" value={referral} onChangeText={(t) => setReferral(t.toUpperCase())} autoCapitalize="characters" maxLength={8} />
        )}

        <View style={styles.sum}>
          {quote && quote.subtotal_cents !== quote.total_cents && <SumLine label="Sous-total" value={euro(quote.subtotal_cents)} />}
          {quote && quote.reward_cents > 0 && <SumLine label="Pizza offerte" value={`−${euro(quote.reward_cents)}`} good />}
          {quote && quote.welcome_cents > 0 && <SumLine label="Offre de bienvenue" value={`−${euro(quote.welcome_cents)}`} good />}
          {quote?.offer && <SumLine label={`Offre ${quote.offer.label}`} value={`−${euro(quote.offer.cents)}`} good />}
          <View style={[styles.total, { borderTopWidth: 1, borderColor: colors.line }]}>
            <Text style={[styles.bold, { flex: 1 }]}>Total</Text>
            <Text style={styles.bold}>{euro(total)}</Text>
          </View>
          {quoteError && <Text style={styles.error}>{quoteError}</Text>}
        </View>

        <Text style={styles.h}>Jour et heure de retrait</Text>
        {slots && slots.days.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
            <View style={styles.dayRow}>
              {slots.days.map((d) => (
                <Pressable
                  key={d.date}
                  disabled={!!d.closed}
                  onPress={() => setChosenDate(d.date === today ? null : d.date)}
                  style={[styles.day, selectedDate === d.date && styles.dayOn, !!d.closed && { opacity: 0.45 }]}
                >
                  <Text style={[styles.dayText, selectedDate === d.date && { color: '#fff' }]}>{dayLabel(d.date, today)}</Text>
                  {d.closed ? <Text style={[styles.dayText, { fontSize: 11 }]}>Fermé</Text> : null}
                </Pressable>
              ))}
            </View>
          </ScrollView>
        )}
        {closed ? (
          <Text style={styles.muted}>Les commandes sont momentanément fermées.</Text>
        ) : slots === null ? (
          <ActivityIndicator color={colors.red} />
        ) : slots.closed ? (
          <Text style={styles.muted}>Fermé ce jour-là{slots.closed !== 'Fermé' ? ` : ${slots.closed}` : ''}.</Text>
        ) : slots.slots.length === 0 ? (
          <Text style={styles.muted}>
            {slots.maxPizzasPerSlot > 0 && pizzas > slots.maxPizzasPerSlot
              ? `Au-delà de ${slots.maxPizzasPerSlot} pizzas, merci d'appeler le restaurant.`
              : selectedDate === today
                ? "Plus de créneau disponible aujourd'hui."
                : 'Plus de créneau disponible ce jour-là.'}
          </Text>
        ) : (
          <View style={styles.wrap}>
            {slots.slots.map((t) => {
              const offer = slots.offers[t];
              const showOffer = offer && cart.subtotalCents >= offer.min_order_cents;
              return (
                <Chip key={t} label={showOffer ? `${t}  −${euro(offer.discount_cents)}` : t} on={pickupTime === t} onPress={() => setPickupTime(t)} />
              );
            })}
          </View>
        )}
        {slots && Object.keys(slots.offers).length > 0 && (
          <Text style={styles.offerHint}>
            💡 {Object.values(slots.offers)[0].label} : un tarif réduit sur certains horaires (marqués d'un −).
          </Text>
        )}

        <Text style={styles.h}>Vos coordonnées</Text>
        <TextInput style={styles.input} placeholder="Prénom" value={name} onChangeText={setName} autoComplete="given-name" />
        <TextInput style={styles.input} placeholder="Téléphone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
        <TextInput style={[styles.input, { height: 70 }]} placeholder="Remarque (facultatif)" value={note} onChangeText={setNote} multiline maxLength={300} />

        {!free && (
          <>
            <Text style={styles.h}>Paiement</Text>
            <View style={styles.wrap}>
              {!mustPayOnline && <Chip label="Au retrait" on={effectiveMethod === 'on_pickup'} onPress={() => setMethod('on_pickup')} />}
              {online && <Chip label="En ligne" on={effectiveMethod === 'online'} onPress={() => setMethod('online')} />}
            </View>
            {mustPayOnline && (
              <Text style={styles.notice}>
                {online
                  ? `Pour une commande de plus de ${euro(config?.prepayOverCents ?? 0)}, le paiement en ligne est demandé.`
                  : `Pour une commande de plus de ${euro(config?.prepayOverCents ?? 0)}, le paiement en ligne est demandé : utilisez l'appli ou appelez le restaurant.`}
              </Text>
            )}
            {config?.holdUnpaid && effectiveMethod === 'on_pickup' && (
              <Text style={styles.notice}>🚶 Vous réglez au retrait : nous lançons votre pizza quand vous nous prévenez avec « J'arrive » (depuis l'onglet Commande), pour qu'elle soit bien chaude.</Text>
            )}
          </>
        )}

        <Pressable style={[styles.submit, (!valid || busy) && { opacity: 0.5 }]} disabled={!valid || busy} onPress={submit}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>{effectiveMethod === 'online' && !free ? `Payer ${euro(total)}` : 'Envoyer la commande'}</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SumLine({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <View style={styles.total}>
      <Text style={[styles.muted, { flex: 1 }]}>{label}</Text>
      <Text style={{ color: good ? colors.green : colors.ink, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { fontSize: 18, color: colors.muted },
  h: { fontSize: 18, fontWeight: '700', color: colors.red, marginTop: 20, marginBottom: 8 },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 },
  lineName: { fontWeight: '600', fontSize: 16 },
  sum: { marginTop: 12 },
  total: { flexDirection: 'row', paddingVertical: 6 },
  bold: { fontWeight: '700', fontSize: 16 },
  muted: { color: colors.muted },
  error: { color: '#B3261E', marginTop: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayRow: { flexDirection: 'row', gap: 8 },
  day: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, alignItems: 'center' },
  dayOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  dayText: { color: colors.ink, fontWeight: '600' },
  offerHint: { color: colors.green, marginTop: 8, fontSize: 13 },
  notice: { backgroundColor: '#eef3fb', borderRadius: 10, padding: 10, marginTop: 10, color: '#23407a' },
  suggest: { marginTop: 12, padding: 12, backgroundColor: '#fff8e6', borderRadius: 12, borderWidth: 1, borderColor: '#f0d98a' },
  suggestTitle: { fontWeight: '700', marginBottom: 8 },
  suggestChip: { backgroundColor: colors.card, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.line },
  reward: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, padding: 12, backgroundColor: '#eaf6ec', borderRadius: 12, borderWidth: 1, borderColor: '#b7dfbd' },
  rewardTitle: { fontWeight: '700', color: colors.green },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, marginTop: 10, fontSize: 16 },
  submit: { backgroundColor: colors.red, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 17 },
});
