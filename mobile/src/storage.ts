import * as SecureStore from 'expo-secure-store';

// Mémorise le nom/téléphone et la dernière commande pour éviter de les ressaisir.
export type Saved = { name: string; phone: string; lastOrderId: string | null };
const KEY = 'littleitaly.saved';

export async function loadSaved(): Promise<Saved> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) return { name: '', phone: '', lastOrderId: null, ...JSON.parse(raw) };
  } catch {}
  return { name: '', phone: '', lastOrderId: null };
}

export async function saveSaved(data: Saved) {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(data));
  } catch {}
}
