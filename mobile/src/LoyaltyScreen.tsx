import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { showAlert } from './alert';
import { euro, Loyalty, updateDevice } from './api';
import { getPushToken } from './push';
import { colors } from './theme';

type Props = { loyalty: Loyalty | null; loyaltyId: string; onChanged: () => void };

export function LoyaltyScreen({ loyalty, loyaltyId, onChanged }: Props) {
  const [busy, setBusy] = useState(false);

  if (!loyalty) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Carte de fidélité indisponible pour le moment.</Text>
      </View>
    );
  }
  const left = loyalty.target - loyalty.progress;

  async function shareCode() {
    const welcome = loyalty!.welcome ? ` pour −${euro(loyalty!.welcome.cents)} sur ta première commande` : '';
    try {
      await Share.share({ message: `Je commande mes pizzas chez Little Italy 🍕 Utilise mon code ${loyalty!.referral_code} dans l'appli${welcome} !` });
    } catch {
      // partage annulé
    }
  }

  async function toggleOffers(on: boolean) {
    setBusy(true);
    try {
      if (on) {
        const token = await getPushToken();
        if (!token) {
          showAlert('Notifications indisponibles', "Autorisez les notifications pour Little Italy dans les réglages du téléphone. (Elles ne fonctionnent pas dans Expo Go sur Android.)");
          return;
        }
        await updateDevice(loyaltyId, { pushToken: token, marketing: true });
      } else {
        await updateDevice(loyaltyId, { marketing: false });
      }
      onChanged();
    } catch (e) {
      showAlert('Erreur', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

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

      {loyalty.referral_code && (
        <View style={styles.box}>
          <Text style={styles.boxTitle}>👫 Parrainez un ami</Text>
          <Text style={styles.muted}>
            Quand votre ami retire sa première commande avec votre code, vous gagnez {loyalty.referral_stamps} tampons.
            {loyalty.welcome ? ` Il profite aussi de −${euro(loyalty.welcome.cents)}.` : ''}
          </Text>
          <Text style={styles.code} selectable>{loyalty.referral_code}</Text>
          <Pressable style={styles.btn} onPress={shareCode}>
            <Text style={styles.btnText}>Partager mon code</Text>
          </Pressable>
        </View>
      )}

      {Platform.OS !== 'web' && (
        <View style={[styles.box, styles.offers]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.boxTitle}>🔔 Recevoir les offres</Text>
            <Text style={styles.muted}>Quelques offres de Little Italy par notification (au maximum une tous les 3 jours). Vous pouvez arrêter à tout moment.</Text>
          </View>
          {busy ? <ActivityIndicator color={colors.red} /> : <Switch value={loyalty.marketing} onValueChange={toggleOffers} trackColor={{ true: colors.red }} />}
        </View>
      )}
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
  box: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginTop: 18, borderWidth: 1, borderColor: colors.line },
  offers: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  boxTitle: { fontSize: 17, fontWeight: '800', color: colors.ink, marginBottom: 4 },
  code: { fontSize: 32, fontWeight: '800', letterSpacing: 4, color: colors.red, textAlign: 'center', marginVertical: 12 },
  btn: { backgroundColor: colors.red, borderRadius: 10, padding: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
});
