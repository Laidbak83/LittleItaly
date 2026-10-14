import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';

// Mémorise le nom/téléphone, la dernière commande et l'identifiant anonyme de la carte de fidélité.
// Sur téléphone : stockage sécurisé. Sur le web : stockage du navigateur.
export type Saved = { name: string; phone: string; lastOrderId: string | null; loyaltyId: string };
const KEY = 'littleitaly.saved';

const read = async () => (Platform.OS === 'web' ? window.localStorage.getItem(KEY) : SecureStore.getItemAsync(KEY));
const write = async (v: string) => (Platform.OS === 'web' ? window.localStorage.setItem(KEY, v) : SecureStore.setItemAsync(KEY, v));

export async function loadSaved(): Promise<Saved> {
  let stored: Partial<Saved> = {};
  try {
    const raw = await read();
    if (raw) stored = JSON.parse(raw);
  } catch {}
  const saved: Saved = { name: '', phone: '', lastOrderId: null, ...stored, loyaltyId: stored.loyaltyId ?? randomUUID() };
  if (!stored.loyaltyId) await saveSaved(saved);
  return saved;
}

export async function saveSaved(data: Saved) {
  try {
    await write(JSON.stringify(data));
  } catch {}
}
