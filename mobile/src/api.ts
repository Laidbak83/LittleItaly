// Adresse du serveur : définie à la compilation via EXPO_PUBLIC_API_URL (voir README).
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export type MenuItem = { id: number; category: string; name: string; description: string; price_cents: number };
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
  items: { name: string; quantity: number; unit_price_cents: number }[];
};
export type AppConfig = { onlinePaymentEnabled: boolean; stripePublishableKey: string | null };

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
export const getMenu = () => request<{ items: MenuItem[] }>('/api/menu').then((r) => r.items);
export const getSlots = () => request<{ slots: string[] }>('/api/slots').then((r) => r.slots);
export const getOrder = (id: string) => request<{ order: Order }>(`/api/orders/${id}`).then((r) => r.order);

export type NewOrder = {
  customerName: string;
  phone: string;
  note: string;
  pickupTime: string;
  paymentMethod: PaymentMethod;
  pushToken: string | null;
  items: { itemId: number; quantity: number }[];
};
export const createOrder = (body: NewOrder) =>
  request<{ order: Order; clientSecret: string | null }>('/api/orders', { method: 'POST', body: JSON.stringify(body) });

export const euro = (cents: number) => (cents / 100).toFixed(2).replace('.', ',') + ' €';
