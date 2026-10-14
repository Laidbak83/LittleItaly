import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import { AppConfig, createOrder, euro, getSlots, Loyalty, MenuData, PaymentMethod, Slots } from './api';
import { useCart } from './cart';
import { buildItemLine, defaultChoice } from './lines';
import { getPushToken } from './push';
import { loadSaved, Saved, saveSaved } from './storage';
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
  const [pickupTime, setPickupTime] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('on_pickup');
  const [useReward, setUseReward] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadSaved().then((s) => {
      setName(s.name);
      setPhone(s.phone);
    });
  }, []);

  const pizzas = cart.pizzaCount;
  useEffect(() => {
    if (cart.count === 0) return;
    setSlots(null);
    getSlots(pizzas)
      .then((r) => {
        setSlots(r);
        setPickupTime((t) => (t && r.slots.includes(t) ? t : null));
      })
      .catch(() => setSlots({ slots: [], maxPizzasPerSlot: 0 }));
  }, [pizzas, cart.count === 0]);

  const eligible = cart.lines.filter((l) => l.rewardEligible);
  const canUseReward = (loyalty?.rewardsAvailable ?? 0) > 0 && eligible.length > 0;
  const discount = useReward && canUseReward ? Math.min(...eligible.map((l) => l.unitCents)) : 0;
  const total = cart.subtotalCents - discount;
  useEffect(() => {
    if (!canUseReward) setUseReward(false);
  }, [canUseReward]);

  // « Il manque une boisson ? » : suggestions rapides quand le panier contient une pizza.
  const suggestions = useMemo(() => {
    if (!menu || pizzas === 0) return [];
    const has = (k: string) => cart.lines.some((l) => l.kinds.includes(k as never));
    const out = [];
    if (!has('boisson')) out.push(...menu.items.filter((i) => i.kind === 'boisson').slice(0, 3));
    if (!has('dessert')) out.push(...menu.items.filter((i) => i.kind === 'dessert').slice(0, 2));
    return out;
  }, [menu, pizzas, cart.lines]);

  if (cart.count === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>Votre panier est vide 🍕</Text>
      </View>
    );
  }

  const closed = config ? !config.ordersOpen : false;
  const valid = !closed && name.trim().length >= 2 && phone.replace(/\D/g, '').length >= 10 && pickupTime;
  const free = total === 0;

  async function submit() {
    if (!valid || !pickupTime) return;
    setBusy(true);
    try {
      const payOnline = method === 'online' && !free;
      const { order, clientSecret } = await createOrder({
        customerName: name.trim(),
        phone,
        note,
        pickupTime,
        paymentMethod: method,
        pushToken: await getPushToken(),
        loyaltyId,
        useReward: useReward && canUseReward,
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
          Alert.alert('Paiement non finalisé', "Votre commande n'a pas été envoyée. Vous pouvez réessayer ou payer au retrait.");
          return;
        }
      }
      const saved: Saved = { ...(await loadSaved()), name: name.trim(), phone, lastOrderId: order.id };
      await saveSaved(saved);
      cart.clear();
      setUseReward(false);
      onOrdered(order.id);
    } catch (e) {
      Alert.alert('Erreur', (e as Error).message);
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

        {discount > 0 && (
          <View style={styles.total}>
            <Text style={[styles.muted, { flex: 1 }]}>Pizza offerte</Text>
            <Text style={{ color: colors.green, fontWeight: '700' }}>−{euro(discount)}</Text>
          </View>
        )}
        <View style={[styles.total, { borderTopWidth: 1, borderColor: colors.line }]}>
          <Text style={[styles.bold, { flex: 1 }]}>Total</Text>
          <Text style={styles.bold}>{euro(total)}</Text>
        </View>

        <Text style={styles.h}>Heure de retrait (aujourd'hui)</Text>
        {closed ? (
          <Text style={styles.muted}>Les commandes sont momentanément fermées.</Text>
        ) : slots === null ? (
          <ActivityIndicator color={colors.red} />
        ) : slots.slots.length === 0 ? (
          <Text style={styles.muted}>
            {slots.maxPizzasPerSlot > 0 && pizzas > slots.maxPizzasPerSlot
              ? `Au-delà de ${slots.maxPizzasPerSlot} pizzas, merci d'appeler le restaurant.`
              : "Plus de créneau disponible aujourd'hui."}
          </Text>
        ) : (
          <View style={styles.wrap}>
            {slots.slots.map((t) => (
              <Chip key={t} label={t} on={pickupTime === t} onPress={() => setPickupTime(t)} />
            ))}
          </View>
        )}

        <Text style={styles.h}>Vos coordonnées</Text>
        <TextInput style={styles.input} placeholder="Prénom" value={name} onChangeText={setName} autoComplete="given-name" />
        <TextInput style={styles.input} placeholder="Téléphone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
        <TextInput style={[styles.input, { height: 70 }]} placeholder="Remarque (facultatif)" value={note} onChangeText={setNote} multiline maxLength={300} />

        {!free && (
          <>
            <Text style={styles.h}>Paiement</Text>
            <View style={styles.wrap}>
              <Chip label="Au retrait" on={method === 'on_pickup'} onPress={() => setMethod('on_pickup')} />
              {config?.onlinePaymentEnabled && <Chip label="En ligne" on={method === 'online'} onPress={() => setMethod('online')} />}
            </View>
          </>
        )}

        <Pressable style={[styles.submit, (!valid || busy) && { opacity: 0.5 }]} disabled={!valid || busy} onPress={submit}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>{method === 'online' && !free ? `Payer ${euro(total)}` : 'Envoyer la commande'}</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { fontSize: 18, color: colors.muted },
  h: { fontSize: 18, fontWeight: '700', color: colors.red, marginTop: 20, marginBottom: 8 },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 },
  lineName: { fontWeight: '600', fontSize: 16 },
  total: { flexDirection: 'row', paddingVertical: 8 },
  bold: { fontWeight: '700', fontSize: 16 },
  muted: { color: colors.muted },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggest: { marginTop: 12, padding: 12, backgroundColor: '#fff8e6', borderRadius: 12, borderWidth: 1, borderColor: '#f0d98a' },
  suggestTitle: { fontWeight: '700', marginBottom: 8 },
  suggestChip: { backgroundColor: colors.card, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.line },
  reward: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, padding: 12, backgroundColor: '#eaf6ec', borderRadius: 12, borderWidth: 1, borderColor: '#b7dfbd' },
  rewardTitle: { fontWeight: '700', color: colors.green },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, marginBottom: 10, fontSize: 16 },
  submit: { backgroundColor: colors.red, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 17 },
});
