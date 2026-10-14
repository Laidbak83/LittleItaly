import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import { AppConfig, createOrder, euro, getSlots, PaymentMethod } from './api';
import { useCart } from './cart';
import { getPushToken } from './push';
import { loadSaved, saveSaved } from './storage';
import { colors } from './theme';

type Props = { config: AppConfig | null; onOrdered: (orderId: string) => void };

export function CartScreen({ config, onOrdered }: Props) {
  const cart = useCart();
  const [slots, setSlots] = useState<string[] | null>(null);
  const [pickupTime, setPickupTime] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('on_pickup');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadSaved().then((s) => {
      setName(s.name);
      setPhone(s.phone);
    });
  }, []);
  useEffect(() => {
    if (cart.count > 0) getSlots().then(setSlots).catch(() => setSlots([]));
  }, [cart.count > 0]);

  if (cart.count === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>Votre panier est vide 🍕</Text>
      </View>
    );
  }

  const valid = name.trim().length >= 2 && phone.replace(/\D/g, '').length >= 10 && pickupTime;

  async function submit() {
    if (!valid || !pickupTime) return;
    setBusy(true);
    try {
      const { order, clientSecret } = await createOrder({
        customerName: name.trim(),
        phone,
        note,
        pickupTime,
        paymentMethod: method,
        pushToken: await getPushToken(),
        items: cart.lines.map((l) => ({ itemId: l.item.id, quantity: l.quantity })),
      });

      if (method === 'online') {
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
          Alert.alert('Paiement non finalisé', 'Votre commande n\'a pas été envoyée. Vous pouvez réessayer ou payer au retrait.');
          return;
        }
      }
      await saveSaved({ name: name.trim(), phone, lastOrderId: order.id });
      cart.clear();
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
        {cart.lines.map(({ item, quantity }) => (
          <View key={item.id} style={styles.line}>
            <Text style={{ flex: 1 }}>
              {quantity} × {item.name}
            </Text>
            <Text>{euro(quantity * item.price_cents)}</Text>
          </View>
        ))}
        <View style={[styles.line, { borderTopWidth: 1, borderColor: colors.line, paddingTop: 10 }]}>
          <Text style={[styles.bold, { flex: 1 }]}>Total</Text>
          <Text style={styles.bold}>{euro(cart.totalCents)}</Text>
        </View>

        <Text style={styles.h}>Heure de retrait (aujourd'hui)</Text>
        {slots === null ? (
          <ActivityIndicator color={colors.red} />
        ) : slots.length === 0 ? (
          <Text style={styles.muted}>Plus de créneau disponible aujourd'hui.</Text>
        ) : (
          <View style={styles.chips}>
            {slots.map((s) => (
              <Pressable key={s} onPress={() => setPickupTime(s)} style={[styles.chip, pickupTime === s && styles.chipOn]}>
                <Text style={pickupTime === s && styles.chipOnText}>{s}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <Text style={styles.h}>Vos coordonnées</Text>
        <TextInput style={styles.input} placeholder="Prénom" value={name} onChangeText={setName} autoComplete="given-name" />
        <TextInput style={styles.input} placeholder="Téléphone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
        <TextInput style={[styles.input, { height: 70 }]} placeholder="Remarque (facultatif)" value={note} onChangeText={setNote} multiline maxLength={300} />

        <Text style={styles.h}>Paiement</Text>
        <View style={styles.chips}>
          <Pressable onPress={() => setMethod('on_pickup')} style={[styles.chip, method === 'on_pickup' && styles.chipOn]}>
            <Text style={method === 'on_pickup' && styles.chipOnText}>Au retrait</Text>
          </Pressable>
          {config?.onlinePaymentEnabled && (
            <Pressable onPress={() => setMethod('online')} style={[styles.chip, method === 'online' && styles.chipOn]}>
              <Text style={method === 'online' && styles.chipOnText}>En ligne</Text>
            </Pressable>
          )}
        </View>

        <Pressable style={[styles.submit, (!valid || busy) && { opacity: 0.5 }]} disabled={!valid || busy} onPress={submit}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{method === 'online' ? `Payer ${euro(cart.totalCents)}` : 'Envoyer la commande'}</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { fontSize: 18, color: colors.muted },
  h: { fontSize: 18, fontWeight: '700', color: colors.red, marginTop: 20, marginBottom: 8 },
  line: { flexDirection: 'row', paddingVertical: 6 },
  bold: { fontWeight: '700', fontSize: 16 },
  muted: { color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.red, borderColor: colors.red },
  chipOnText: { color: '#fff', fontWeight: '600' },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, marginBottom: 10, fontSize: 16 },
  submit: { backgroundColor: colors.red, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 17 },
});
