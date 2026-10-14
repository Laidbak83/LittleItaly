import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Loyalty } from './api';
import { colors } from './theme';

export function LoyaltyScreen({ loyalty }: { loyalty: Loyalty | null }) {
  if (!loyalty) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Carte de fidélité indisponible pour le moment.</Text>
      </View>
    );
  }
  const left = loyalty.target - loyalty.progress;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.title}>Ma carte de fidélité</Text>
      <Text style={styles.muted}>Une pizza retirée = un tampon. À {loyalty.target} tampons, la pizza suivante est offerte !</Text>

      {loyalty.rewardsAvailable > 0 && (
        <View style={styles.reward}>
          <Text style={styles.rewardText}>
            🎁 {loyalty.rewardsAvailable} pizza{loyalty.rewardsAvailable > 1 ? 's' : ''} offerte{loyalty.rewardsAvailable > 1 ? 's' : ''} à utiliser dans votre panier
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <View style={styles.grid}>
          {Array.from({ length: loyalty.target }, (_, i) => (
            <View key={i} style={[styles.stamp, i < loyalty.progress && styles.stampOn]}>
              <Text style={{ fontSize: 22, opacity: i < loyalty.progress ? 1 : 0.25 }}>🍕</Text>
            </View>
          ))}
        </View>
        <Text style={styles.count}>
          {loyalty.progress} / {loyalty.target}
        </Text>
        <Text style={styles.muted}>
          {left === 1 ? 'Plus qu’un tampon avant votre pizza offerte !' : `Encore ${left} pizzas avant votre pizza offerte.`}
        </Text>
      </View>
      <Text style={styles.small}>Les tampons sont ajoutés quand vous retirez votre commande au restaurant.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 26, fontWeight: '800', color: colors.red, marginBottom: 6 },
  muted: { color: colors.muted },
  small: { color: colors.muted, fontSize: 13, marginTop: 8 },
  reward: { backgroundColor: '#eaf6ec', borderColor: '#b7dfbd', borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 16 },
  rewardText: { color: colors.green, fontWeight: '700', fontSize: 16 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, marginTop: 16, borderWidth: 1, borderColor: colors.line, alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginBottom: 12 },
  stamp: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  stampOn: { borderStyle: 'solid', borderColor: colors.red, backgroundColor: '#fdecee' },
  count: { fontSize: 28, fontWeight: '800', color: colors.ink },
});
