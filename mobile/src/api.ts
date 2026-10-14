import { Platform } from 'react-native';

// En développement : l'émulateur Android joint le PC via 10.0.2.2 ; sinon localhost.
// En production : définir EXPO_PUBLIC_API_URL (voir .env.example).
const devHost = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? `http://${devHost}:3000`;

export type Kind = 'pizza' | 'boisson' | 'dessert' | 'autre';
export type Size = { label: string; extra_cents: number };
export type MenuItem = {
  id: number;
  category: string;
  name: string;
  description: string;
  price_cents: number;
  kind: Kind;
  vegetarian: boolean;
  allergens: string[];
  ingredients: string[];
  sizes: Size[];
  image_url: string | null;
  regular_price_cents: number | null; // renseigné quand price_cents est un prix promo (pizza de la semaine)
  rating_avg: number | null;
  rating_count: number;
};
export type Supplement = { id: number; name: string; price_cents: number };
export type Combo = { id: number; name: string; description: string; price_cents: number; slots: Kind[] };
export type MenuData = {
  items: MenuItem[];
  supplements: Supplement[];
  combos: Combo[];
  banner: string;
  halfAndHalf: boolean;
  featured: { itemId: number; note: string; until: string | null } | null;
  bestSellers: number[];
};

// Ce que l'appli envoie au serveur pour une ligne : des identifiants et des choix, jamais de prix.
export type LineConfig =
  | { itemId: number; quantity: number; sizeIndex?: number; extras?: number[]; removed?: string[]; halfItemId?: number }
  | { comboId: number; quantity: number; picks: number[] };

export type OrderStatus = 'pending_payment' | 'new' | 'preparing' | 'ready' | 'done' | 'cancelled';
export type PaymentMethod = 'online' | 'on_pickup';
export type Order = {
  id: string;
  number: number;
  customer_name: string;
  pickup_time: string;
  payment_method: PaymentMethod;
  payment_status: 'pending' | 'paid' | 'unpaid';
  status: OrderStatus;
  total_cents: number;
  discount_cents: number;
  reward_used: number;
  items: { name: string; details: string; quantity: number; unit_price_cents: number; config: LineConfig }[];
  // Présents seulement une fois la commande retirée :
  rateable?: { itemId: number; name: string }[];
  ratings?: { itemId: number; rating: number }[];
};
export type AppConfig = {
  onlinePaymentEnabled: boolean;
  stripePublishableKey: string | null;
  ordersOpen: boolean;
  rewardTarget: number;
};
export type Loyalty = { progress: number; target: number; rewardsAvailable: number; totalStamps: number };
export type Slots = { slots: string[]; maxPizzasPerSlot: number };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new Error('Impossible de joindre le serveur. Vérifiez votre connexion.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
  return data as T;
}

export const getConfig = () => request<AppConfig>('/api/config');
export const getMenu = () => request<MenuData>('/api/menu');
export const getSlots = (pizzas: number) => request<Slots>(`/api/slots?pizzas=${Math.max(pizzas, 1)}`);
export const getOrder = (id: string) => request<{ order: Order }>(`/api/orders/${id}`).then((r) => r.order);
export const rateOrder = (orderId: string, ratings: { itemId: number; rating: number }[], comment: string) =>
  request<{ ok: boolean }>(`/api/orders/${orderId}/ratings`, { method: 'POST', body: JSON.stringify({ ratings, comment }) });

export const getLoyalty = (id: string) => request<Loyalty>(`/api/loyalty/${id}`);

export type NewOrder = {
  customerName: string;
  phone: string;
  note: string;
  pickupTime: string;
  paymentMethod: PaymentMethod;
  pushToken: string | null;
  loyaltyId: string;
  useReward: boolean;
  items: LineConfig[];
};
export const createOrder = (body: NewOrder) =>
  request<{ order: Order; clientSecret: string | null }>('/api/orders', { method: 'POST', body: JSON.stringify(body) });

export const euro = (cents: number) => (cents / 100).toFixed(2).replace('.', ',') + ' €';
export const ratingText = (avg: number) => avg.toFixed(1).replace('.', ',');
export const frDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
export const imageUrl = (path: string | null) => (path ? API_URL + path : null);
