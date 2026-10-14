import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const NORMAL_GRANDE = JSON.stringify([
  { label: 'Normale', extra_cents: 0 },
  { label: 'Grande', extra_cents: 400 },
]);

// Données d'EXEMPLE : à remplacer par la vraie carte d'Olivier (via /admin).
// Les allergènes sont indicatifs et doivent être vérifiés par le restaurant.
// [catégorie, nom, description, prix, kind, végétarien, allergènes, ingrédients, tailles]
const SEED_MENU = [
  ['Pizzas', 'Margherita', 'Tomate, mozzarella, basilic', 900, 'pizza', 1, 'gluten,lait', 'Tomate,Mozzarella,Basilic', NORMAL_GRANDE],
  ['Pizzas', 'Reine', 'Tomate, mozzarella, jambon, champignons', 1100, 'pizza', 0, 'gluten,lait', 'Tomate,Mozzarella,Jambon,Champignons', NORMAL_GRANDE],
  ['Pizzas', 'Regina', 'Tomate, mozzarella, jambon, olives', 1100, 'pizza', 0, 'gluten,lait', 'Tomate,Mozzarella,Jambon,Olives', NORMAL_GRANDE],
  ['Pizzas', 'Calzone', 'Tomate, mozzarella, jambon, œuf', 1200, 'pizza', 0, 'gluten,lait,œufs', 'Tomate,Mozzarella,Jambon,Œuf', NORMAL_GRANDE],
  ['Pizzas', '4 fromages', 'Mozzarella, gorgonzola, chèvre, parmesan', 1300, 'pizza', 1, 'gluten,lait', 'Mozzarella,Gorgonzola,Chèvre,Parmesan', NORMAL_GRANDE],
  ['Pizzas', 'Diavola', 'Tomate, mozzarella, chorizo piquant', 1250, 'pizza', 0, 'gluten,lait', 'Tomate,Mozzarella,Chorizo piquant', NORMAL_GRANDE],
  ['Boissons', 'Coca-Cola 33cl', '', 300, 'boisson', 1, '', '', '[]'],
  ['Boissons', 'Eau minérale 50cl', '', 200, 'boisson', 1, '', '', '[]'],
  ['Desserts', 'Tiramisu', 'Fait maison', 450, 'dessert', 1, 'gluten,lait,œufs', '', '[]'],
];
const SEED_SUPPLEMENTS = [['Œuf', 100], ['Chèvre', 150], ['Jambon', 150], ['Chorizo', 150], ['Champignons', 100], ['Olives', 100]];
const SEED_COMBOS = [
  ['Formule Midi', 'Une pizza + une boisson', 1100, ['pizza', 'boisson']],
  ['Formule Duo', 'Une pizza + une boisson + un dessert', 1400, ['pizza', 'boisson', 'dessert']],
];

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      kind TEXT NOT NULL DEFAULT 'autre' CHECK (kind IN ('pizza','boisson','dessert','autre')),
      vegetarian INTEGER NOT NULL DEFAULT 0,
      allergens TEXT NOT NULL DEFAULT '',
      ingredients TEXT NOT NULL DEFAULT '',
      sizes TEXT NOT NULL DEFAULT '[]',
      image_url TEXT,
      available INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS supplements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      available INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS combos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      slots TEXT NOT NULL,
      available INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS loyalty (
      customer_id TEXT PRIMARY KEY,
      stamps INTEGER NOT NULL DEFAULT 0,
      rewards_used INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      number INTEGER NOT NULL,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      pickup_date TEXT NOT NULL,
      pickup_time TEXT NOT NULL,
      payment_method TEXT NOT NULL CHECK (payment_method IN ('online','on_pickup')),
      payment_status TEXT NOT NULL CHECK (payment_status IN ('pending','paid','unpaid')),
      status TEXT NOT NULL CHECK (status IN ('pending_payment','new','preparing','ready','done','cancelled')),
      total_cents INTEGER NOT NULL,
      discount_cents INTEGER NOT NULL DEFAULT 0,
      pizza_count INTEGER NOT NULL DEFAULT 0,
      loyalty_id TEXT,
      reward_used INTEGER NOT NULL DEFAULT 0,
      stamps_credited INTEGER NOT NULL DEFAULT 0,
      push_token TEXT,
      stripe_payment_intent TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_cents INTEGER NOT NULL,
      config TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_orders_pickup ON orders(pickup_date, pickup_time);
  `);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM menu_items').get();
  if (n === 0) {
    const insert = db.prepare(
      `INSERT INTO menu_items (category, name, description, price_cents, kind, vegetarian, allergens, ingredients, sizes, position)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    );
    SEED_MENU.forEach((row, i) => insert.run(...row, i));
    const sup = db.prepare('INSERT INTO supplements (name, price_cents) VALUES (?,?)');
    SEED_SUPPLEMENTS.forEach((row) => sup.run(...row));
    const combo = db.prepare('INSERT INTO combos (name, description, price_cents, slots) VALUES (?,?,?,?)');
    SEED_COMBOS.forEach(([a, b, c, d]) => combo.run(a, b, c, JSON.stringify(d)));
  }
  return db;
}
