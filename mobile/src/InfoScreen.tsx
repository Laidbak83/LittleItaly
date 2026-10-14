import React from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppConfig } from './api';
import { colors } from './theme';

const DAYS = [
  { n: 1, label: 'Lundi' }, { n: 2, label: 'Mardi' }, { n: 3, label: 'Mercredi' }, { n: 4, label: 'Jeudi' },
  { n: 5, label: 'Vendredi' }, { n: 6, label: 'Samedi' }, { n: 0, label: 'Dimanche' },
];
const fmt = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

// Infos pratiques : adresse, appeler, itinéraire, horaires de retrait, fermetures.
export function InfoScreen({ config, onClose }: { config: AppConfig | null; onClose: () => void }) {
  const info = config?.info;
  const mapsUrl = info?.mapsUrl || (info?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(info.address)}` : '');
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Little Italy</Text>
            <Pressable onPress={onClose} accessibilityLabel="Fermer" hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.muted}>Pizzas à emporter · Trans-en-Provence</Text>

          {info?.address ? <Text style={styles.address}>📍 {info.address}</Text> : null}
          <View style={styles.actions}>
            {info?.phone ? (
              <Pressable style={styles.btn} onPress={() => Linking.openURL(`tel:${info.phone.replace(/\s/g, '')}`)}>
                <Text style={styles.btnText}>📞 Appeler</Text>
              </Pressable>
            ) : null}
            {mapsUrl ? (
              <Pressable style={styles.btn} onPress={() => Linking.openURL(mapsUrl)}>
                <Text style={styles.btnText}>🗺️ Itinéraire</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.h}>Horaires de retrait</Text>
          <View style={styles.card}>
            {DAYS.map((d) => {
              const ranges = config?.hours[String(d.n)] ?? [];
              return (
                <View key={d.n} style={styles.row}>
                  <Text style={styles.day}>{d.label}</Text>
                  <Text style={ranges.length ? styles.hours : styles.closed}>
                    {ranges.length ? ranges.map(([a, b]) => `${a} – ${b}`).join(' · ') : 'Fermé'}
                  </Text>
                </View>
              );
            })}
          </View>

          {config && config.closures.length > 0 && (
            <>
              <Text style={styles.h}>Fermetures prévues</Text>
              <View style={styles.card}>
                {config.closures.map((c, i) => (
                  <Text key={i} style={styles.closure}>
                    {c.date_from === c.date_to ? fmt(c.date_from) : `${fmt(c.date_from)} → ${fmt(c.date_to)}`}
                    {c.reason ? ` · ${c.reason}` : ''}
                  </Text>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 26, fontWeight: '800', color: colors.red, flex: 1 },
  close: { fontSize: 24, color: colors.muted, padding: 4 },
  muted: { color: colors.muted },
  address: { fontSize: 16, marginTop: 16, color: colors.ink },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { backgroundColor: colors.red, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  btnText: { color: '#fff', fontWeight: '700' },
  h: { fontSize: 18, fontWeight: '700', color: colors.red, marginTop: 24, marginBottom: 8 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', paddingVertical: 5 },
  day: { width: 100, fontWeight: '600', color: colors.ink },
  hours: { color: colors.ink },
  closed: { color: colors.muted },
  closure: { paddingVertical: 4, color: colors.ink },
});
