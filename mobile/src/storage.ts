import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';

// Mémorise le nom/téléphone, la dernière commande et l'identifiant anonyme de la carte de fidélité.
export type Saved = { name: string; phone: string; lastOrderId: string | null; loyaltyId: string };
const KEY = 'littleitaly.saved';

export async function loadSaved(): Promise<Saved> {
  let stored: Partial<Saved> = {};
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) stored = JSON.parse(raw);
  } catch {}
  const saved: Saved = { name: '', phone: '', lastOrderId: null, ...stored, loyaltyId: stored.loyaltyId ?? randomUUID() };
  if (!stored.loyaltyId) await saveSaved(saved);
  return saved;
}

export async function saveSaved(data: Saved) {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(data));
  } catch {}
}
