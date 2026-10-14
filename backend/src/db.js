import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SEED_MENU = [
  // Données d'exemple : à remplacer par la vraie carte d'Olivier (via l'admin).
  ['Pizzas', 'Margherita', 'Tomate, mozzarella, basilic', 900],
  ['Pizzas', 'Reine', 'Tomate, mozzarella, jambon, champignons', 1100],
  ['Pizzas', 'Regina', 'Tomate, mozzarella, jambon, olives', 1100],
  ['Pizzas', 'Calzone', 'Tomate, mozzarella, jambon, œuf', 1200],
  ['Pizzas', '4 fromages', 'Mozzarella, gorgonzola, chèvre, parmesan', 1300],
  ['Pizzas', 'Diavola', 'Tomate, mozzarella, chorizo piquant', 1250],
  ['Boissons', 'Coca-Cola 33cl', '', 300],
  ['Boissons', 'Eau minérale 50cl', '', 200],
  ['Desserts', 'Tiramisu', 'Fait maison', 450],
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
      available INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0
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
      push_token TEXT,
      stripe_payment_intent TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_cents INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_pickup ON orders(pickup_date, pickup_time);
  `);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM menu_items').get();
  if (n === 0) {
    const insert = db.prepare(
      'INSERT INTO menu_items (category, name, description, price_cents, position) VALUES (?,?,?,?,?)',
    );
    SEED_MENU.forEach((row, i) => insert.run(...row, i));
  }
  return db;
}
