import { Platform } from 'react-native';

// En développement : l'émulateur Android joint le PC via 10.0.2.2 ; sinon localhost.
// En production : définir EXPO_PUBLIC_API_URL (voir .env.example).
const devHost = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
// Version web : servie par le backend lui-même (même adresse) ; en développement (port 8081), le backend est sur le port 3000.
const webOrigin = () => {
  const { origin, port, protocol, hostname } = window.location;
  return port === '8081' || port === '19006' ? `${protocol}//${hostname}:3000` : origin;
};
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'web' ? webOrigin() : `http://${devHost}:3000`);

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
  sold_out: boolean; // épuisé aujourd'hui
  regular_price_cents: number | null; // renseigné quand price_cents est un prix promo (pizza de la semaine)
  rating_avg: number | null;
  rating_count: number;
};
export type Supplement = { id: number; name: string; price_cents: number; sold_out: boolean };
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
  pickup_date: string;
  pickup_time: string;
  pickup_at: string; // instant exact du retrait (ISO)
  pickup_in_days: number; // 0 = aujourd'hui, 1 = demain…
  hold_until_arrival: boolean; // la cuisine attend le « J'arrive » du client
  arrival_eta_at: string | null;
  arrival_here: number;
  offer_discount_cents: number;
  offer_label: string | null;
  welcome_discount_cents: number;
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
  info: { address: string; phone: string; mapsUrl: string; reviewUrl: string };
  hours: Record<string, [string, string][]>; // horaires de retrait par jour (0 = dimanche)
  closures: { date_from: string; date_to: string; reason: string }[];
  maxAdvanceDays: number;
  referral: { stamps: number } | null;
  welcome: { cents: number; min_cents: number } | null;
  holdUnpaid: boolean;
  prepayOverCents: number;
};
export type Loyalty = {
  progress: number;
  target: number;
  rewardsAvailable: number;
  totalStamps: number;
  referral_code: string | null;
  referral_stamps: number;
  welcome: { cents: number; min_cents: number } | null;
  marketing: boolean;
};
export type SlotOffer = { label: string; discount_cents: number; min_order_cents: number };
export type Slots = {
  date: string;
  slots: string[];
  maxPizzasPerSlot: number;
  offers: Record<string, SlotOffer>;
  closed: string | null;
  days: { date: string; closed: string | null }[];
};
export type Quote = {
  date: string;
  subtotal_cents: number;
  reward_cents: number;
  welcome_cents: number;
  offer: { id: number; label: string; cents: number } | null;
  total_cents: number;
  requires_online: boolean;
  referral_ok: boolean;
  pizzas: number;
};

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
export const getSlots = (pizzas: number, date?: string) =>
  request<Slots>(`/api/slots?pizzas=${Math.max(pizzas, 1)}${date ? `&date=${date}` : ''}`);
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
  pickupDate?: string;
  referralCode?: string;
  items: LineConfig[];
};
export type QuoteInput = Pick<NewOrder, 'items' | 'pickupTime' | 'loyaltyId' | 'useReward' | 'pickupDate' | 'referralCode'> & { phone?: string };
// Le total exact (remises comprises) calculé par le serveur : c'est ce que l'appli affiche.
export const getQuote = (body: Partial<QuoteInput>) => request<Quote>('/api/quote', { method: 'POST', body: JSON.stringify(body) });
// « J'arrive » : 0 = je suis là, sinon dans 5/10/15/20 minutes.
export const sendArrival = (orderId: string, minutes: 0 | 5 | 10 | 15 | 20) =>
  request<{ order: Order }>(`/api/orders/${orderId}/arrival`, { method: 'POST', body: JSON.stringify({ minutes }) }).then((r) => r.order);
// Jeton de notification et accord pour recevoir des offres (identifié par la carte de fidélité).
export const updateDevice = (loyaltyId: string, body: { pushToken?: string | null; marketing?: boolean }) =>
  request<{ ok: boolean }>(`/api/devices/${loyaltyId}`, { method: 'PUT', body: JSON.stringify(body) });
export const createOrder = (body: NewOrder) =>
  request<{ order: Order; clientSecret: string | null }>('/api/orders', { method: 'POST', body: JSON.stringify(body) });

export const euro = (cents: number) => (cents / 100).toFixed(2).replace('.', ',') + ' €';
export const ratingText = (avg: number) => avg.toFixed(1).replace('.', ',');
export const frDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
export const dayLabel = (iso: string, today: string) => {
  const d = new Date(`${iso}T12:00:00`);
  const diff = Math.round((d.getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Demain';
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
};
export const imageUrl = (path: string | null) => (path ? API_URL + path : null);
