// Crée quelques commandes de démonstration pour tester l'écran de la cuisine (/admin).
// Usage : npm run demo   (le backend doit tourner)   —   BASE_URL=http://... npm run demo
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

async function api(path, init) {
  const res = await fetch(BASE + path, { headers: { 'content-type': 'application/json' }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status} ${data.error ?? ''}`);
  return data;
}

const [menu, { slots }] = await Promise.all([api('/api/menu'), api('/api/slots?pizzas=1')]).catch((e) => {
  console.error('Backend injoignable ou carte vide :', e.message);
  process.exit(1);
});
if (!slots.length) {
  console.error("Aucun créneau disponible maintenant (restaurant fermé ?). Lancez `npm run dev` : les créneaux y sont ouverts 24h/24.");
  process.exit(1);
}
const item = (name) => menu.items.find((i) => i.name === name) ?? (() => { throw new Error(`Article introuvable : ${name}`); })();
const extra = (name) => menu.supplements.find((s) => s.name === name)?.id;
const at = (n) => slots[Math.min(n, slots.length - 1)];

const demo = [
  { customerName: 'Marie', phone: '06 12 34 56 78', pickupTime: at(0), note: 'Bien cuite svp',
    items: [{ itemId: item('Pacino').id, quantity: 2 }, { itemId: item('Coca-Cola').id, quantity: 1 }] },
  { customerName: 'Julien', phone: '06 98 76 54 32', pickupTime: at(1),
    items: [{ itemId: item('Calzone').id, quantity: 1, extras: [extra('Œuf')], removed: ['Champignons'] }] },
  { customerName: 'Sophie', phone: '07 11 22 33 44', pickupTime: at(2),
    items: [{ comboId: menu.combos[0].id, quantity: 1, picks: [item('Pop Toys').id] }, { itemId: item('Tiramisu spéculos').id, quantity: 1 }] },
];

for (const order of demo) {
  const { order: o } = await api('/api/orders', { method: 'POST', body: JSON.stringify({ ...order, paymentMethod: 'on_pickup' }) });
  console.log(`✓ commande n°${o.number} — ${o.customer_name}, retrait ${o.pickup_time}, ${(o.total_cents / 100).toFixed(2)} €`);
}
console.log(`\nOuvrez ${BASE}/admin (code : dev-admin) pour les voir.`);
