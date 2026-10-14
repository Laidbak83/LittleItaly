import React, { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { showAlert } from './alert';
import { Order, rateOrder } from './api';
import { colors } from './theme';
import { Stars } from './ui';

// « Comment était votre pizza ? » : visible une fois la commande retirée.
export function RatingCard({ order, reviewUrl, onDone }: { order: Order; reviewUrl?: string; onDone: () => void }) {
  const [draft, setDraft] = useState<Record<number, number>>({});
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const rateable = order.rateable ?? [];
  const done = new Map((order.ratings ?? []).map((r) => [r.itemId, r.rating]));
  if (rateable.length === 0) return null;
  const todo = rateable.filter((r) => !done.has(r.itemId));
  const picked = Object.entries(draft).map(([itemId, rating]) => ({ itemId: Number(itemId), rating }));

  async function send() {
    setBusy(true);
    try {
      await rateOrder(order.id, picked, comment);
      onDone();
    } catch (e) {
      showAlert('Erreur', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{todo.length ? 'Comment était votre commande ?' : 'Merci pour votre avis ! 🙏'}</Text>
      {rateable.map((r) => (
        <View key={r.itemId} style={styles.row}>
          <Text style={styles.name}>{r.name}</Text>
          {done.has(r.itemId) ? (
            <Stars value={done.get(r.itemId)!} size={24} />
          ) : (
            <Stars value={draft[r.itemId] ?? 0} size={30} onChange={(v) => setDraft({ ...draft, [r.itemId]: v })} />
          )}
        </View>
      ))}
      {/* Invité à laisser un avis Google quelle que soit sa note (Google interdit de ne solliciter que les bons avis). */}
      {reviewUrl ? (
        <Pressable onPress={() => Linking.openURL(reviewUrl)}>
          <Text style={styles.google}>⭐ Laisser aussi un avis sur Google</Text>
        </Pressable>
      ) : null}
      {todo.length > 0 && (
        <>
          <TextInput
            style={styles.input}
            placeholder="Un petit mot pour le restaurant (facultatif)"
            value={comment}
            onChangeText={setComment}
            multiline
            maxLength={300}
          />
          <Pressable style={[styles.btn, (picked.length === 0 || busy) && { opacity: 0.5 }]} disabled={picked.length === 0 || busy} onPress={send}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Envoyer mon avis</Text>}
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff8e6', borderColor: '#f0d98a', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16 },
  title: { fontWeight: '700', fontSize: 17, marginBottom: 8, color: colors.ink },
  row: { paddingVertical: 8 },
  name: { fontWeight: '600', marginBottom: 4, color: colors.ink },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 10, marginTop: 8, minHeight: 60, fontSize: 15 },
  google: { color: colors.red, fontWeight: '700', marginTop: 8 },
  btn: { backgroundColor: colors.red, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 10 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
