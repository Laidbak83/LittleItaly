// DÉMO uniquement : fabrique ~45 jours d'historique (commandes, clients, avis) pour voir les statistiques
// et le fichier clients remplis. Usage : npm run demo:history   (--force pour ajouter à une base déjà utilisée)
// Ne JAMAIS lancer sur la base de production : les clients et commandes sont inventés.
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { priceLine } from '../src/pricing.js';
import { addStamps } from '../src/loyalty.js';
import { addDays } from '../src/stats.js';
import { localNow } from '../src/time.js';

const config = loadConfig();
const db = openDb(config.dbPath);
if (db.prepare('SELECT COUNT(*) AS n FROM orders').get().n > 0 && !process.argv.includes('--force')) {
  console.error('La base contient déjà des commandes. Ajoutez --force pour insérer quand même des données de démo.');
  process.exit(1);
}

let seed = 20261014;
const rnd = () => ((seed = (seed + 0x6d2b79f5) | 0), ((t) => ((t = Math.imul(t ^ (t >>> 15), t | 1)), (t ^= t + Math.imul(t ^ (t >>> 7), t | 61)), ((t ^ (t >>> 14)) >>> 0) / 4294967296))(seed));
const pick = (arr, weights) => {
  const w = weights ?? arr.map(() => 1);
  let r = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < arr.length; i++) if ((r -= w[i]) < 0) return arr[i];
  return arr.at(-1);
};

const items = db.prepare('SELECT * FROM menu_items WHERE available = 1').all();
const pizzas = items.filter((i) => i.kind === 'pizza');
const drinks = items.filter((i) => i.kind === 'boisson');
const desserts = items.filter((i) => i.kind === 'dessert');
const supplements = db.prepare('SELECT id FROM supplements WHERE available = 1').all();
const combos = db.prepare('SELECT * FROM combos WHERE available = 1').all();
// Quelques pizzas très populaires, d'autres moins : plus réaliste pour un classement.
const pizzaWeights = pizzas.map((_, i) => [9, 6, 5, 4, 3, 3, 2, 2, 2, 1.5, 1][i] ?? 1);

const FIRST = ['Julie', 'Marc', 'Sophie', 'Thomas', 'Camille', 'Nicolas', 'Léa', 'Antoine', 'Emma', 'Hugo', 'Chloé', 'Lucas', 'Manon', 'Théo', 'Sarah', 'Maxime', 'Laura', 'Romain', 'Inès', 'Kevin', 'Pauline', 'Julien', 'Clara', 'Alexis', 'Marion', 'Florian', 'Océane', 'Damien', 'Élise', 'Pierre'];
const customers = FIRST.map((name, i) => ({
  name, phone: `06${String(10000000 + i * 137).padStart(8, '0')}`.slice(0, 10),
  loyaltyId: `demo-customer-${String(i).padStart(2, '0')}-abcdefghijkl`, weight: i < 8 ? 6 : i < 18 ? 3 : 1,
}));
const COMMENTS = ['Délicieuse, pâte parfaite !', 'Très bon, un peu long à l’arrivée.', 'Ma pizza préférée du coin.', 'Super accueil et pizza bien garnie.', 'Excellent rapport qualité-prix.', 'Un peu trop salée à mon goût.', 'Je recommande !'];

const today = localNow(config.timezone).date;
const loyaltyIds = new Set();
let total = 0;
const insertOrder = db.prepare(`INSERT INTO orders (id, number, customer_name, phone, note, pickup_date, pickup_time, payment_method, payment_status,
  status, total_cents, discount_cents, pizza_count, loyalty_id, reward_used, stamps_credited, feedback, created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,0,?,?,?)`);
const insertLine = db.prepare('INSERT INTO order_items (order_id, name, details, quantity, unit_price_cents, config) VALUES (?,?,?,?,?,?)');
const insertRating = db.prepare('INSERT OR IGNORE INTO ratings (order_id, item_id, rating, created_at) VALUES (?,?,?,?)');

db.exec('BEGIN');
for (let back = 44; back >= 0; back--) {
  const date = addDays(today, -back);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const base = [5, 7, 7, 8, 12, 15, 18][(weekday + 6) % 7]; // lundi … dimanche
  const count = Math.round(base * (0.75 + rnd() * 0.5) * (0.8 + (44 - back) / 220)); // légère croissance
  const closing = weekday === 0 ? '15:00' : [1, 2, 3].includes(weekday) ? '19:00' : '22:00';
  const nowMinutes = (() => { const l = localNow(config.timezone); return l.minutes; })();
  for (let n = 1; n <= count; n++) {
    // heures de pointe : midi et début de soirée
    let hour = pick([11, 12, 13, 14, 18, 19, 20, 21], [1, 9, 8, 1, 2, 8, 8, 2]);
    if (`${String(hour).padStart(2, '0')}:00` >= closing) hour = 12;
    const minute = pick([0, 15, 30, 45]);
    const pickupTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (date === today && hour * 60 + minute > nowMinutes + 30) continue; // pas de commande « dans le futur » aujourd'hui
    const c = pick(customers, customers.map((x) => x.weight));
    const lines = [];
    if (rnd() < 0.18 && combos.length) lines.push({ comboId: pick(combos).id, quantity: 1, picks: [pick(pizzas, pizzaWeights).id] });
    const nPizza = lines.length ? 0 : pick([1, 2, 3, 4], [4, 5, 2, 1]);
    for (let i = 0; i < nPizza; i++) {
      const line = { itemId: pick(pizzas, pizzaWeights).id, quantity: 1 };
      if (rnd() < 0.25) line.extras = [pick(supplements).id];
      lines.push(line);
    }
    if (rnd() < 0.5 && drinks.length) lines.push({ itemId: pick(drinks).id, quantity: pick([1, 2]) });
    if (rnd() < 0.2 && desserts.length) lines.push({ itemId: pick(desserts).id, quantity: 1 });
    const priced = lines.map((l) => priceLine(db, l));
    const totalCents = priced.reduce((s, l) => s + l.unitCents * l.quantity, 0);
    const pizzaCount = priced.reduce((s, l) => s + l.pizzas, 0);
    const past = date !== today || hour * 60 + minute < nowMinutes - 20;
    const status = past ? 'done' : pick(['new', 'preparing', 'ready']);
    const online = rnd() < 0.3;
    const id = `demo-${date}-${n}`;
    const created = `${date}T${String(Math.max(hour - 2, 0)).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
    const comment = status === 'done' && rnd() < 0.12 ? pick(COMMENTS) : null;
    insertOrder.run(id, n, c.name, c.phone, '', date, pickupTime, online ? 'online' : 'on_pickup', online ? 'paid' : 'unpaid',
      status, totalCents, pizzaCount, c.loyaltyId, status === 'done' ? 1 : 0, comment, created);
    for (const l of priced) insertLine.run(id, l.name, l.details, l.quantity, l.unitCents, JSON.stringify(l.config));
    if (status === 'done') {
      addStamps(db, c.loyaltyId, pizzaCount);
      loyaltyIds.add(c.loyaltyId);
      if (rnd() < 0.4) {
        for (const l of priced) {
          const ids = l.config.comboId !== undefined ? l.config.picks : [l.config.itemId];
          for (const itemId of ids) if (pizzas.some((p) => p.id === itemId)) insertRating.run(id, itemId, pick([5, 4, 3, 2], [8, 5, 1.5, 0.5]), created);
        }
      }
    }
    total++;
  }
}
db.exec('COMMIT');
console.log(`✓ ${total} commandes de démonstration créées sur 45 jours (${customers.length} clients fictifs).`);
console.log('Ouvrez /admin → Stats et Clients. Pour repartir de zéro : arrêtez le serveur et supprimez le dossier backend/data.');
