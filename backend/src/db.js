import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { seedMenu } from './seed.js';

function ensureColumn(db, table, column, ddl) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

export function openDb(path, { seed = true } = {}) {
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
    CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
    CREATE TABLE IF NOT EXISTS ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      created_at TEXT NOT NULL,
      UNIQUE (order_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ratings_item ON ratings(item_id);
    CREATE TABLE IF NOT EXISTS owner_subscriptions (
      endpoint TEXT PRIMARY KEY,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS slot_offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      weekdays TEXT NOT NULL DEFAULT '',
      discount_cents INTEGER NOT NULL CHECK (discount_cents > 0),
      min_order_cents INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS closures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS referral_codes (
      loyalty_id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS devices (
      loyalty_id TEXT PRIMARY KEY,
      push_token TEXT,
      marketing INTEGER NOT NULL DEFAULT 0,
      marketing_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sent_at TEXT NOT NULL,
      segment TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      recipients INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customer_notes (
      phone TEXT PRIMARY KEY,
      note TEXT NOT NULL DEFAULT ''
    );
  `);
  // Bases créées avant l'ajout des avis : on complète sans rien perdre.
  ensureColumn(db, 'orders', 'feedback', 'TEXT');
  // Chronométrage de la cuisine (quand chaque étape a été déclenchée) et notifications déjà envoyées.
  for (const col of ['preparing_at', 'ready_at', 'done_at']) ensureColumn(db, 'orders', col, 'TEXT');
  // Arrivée du client (« J'arrive »), offres, parrainage, articles épuisés.
  ensureColumn(db, 'orders', 'arrival_eta_at', 'TEXT');
  for (const col of ['arrival_here', 'notified_arrive', 'offer_discount_cents', 'welcome_discount_cents', 'referral_credited']) {
    ensureColumn(db, 'orders', col, 'INTEGER NOT NULL DEFAULT 0');
  }
  ensureColumn(db, 'orders', 'offer_label', 'TEXT');
  ensureColumn(db, 'orders', 'referred_by', 'TEXT');
  ensureColumn(db, 'menu_items', 'sold_out_date', 'TEXT');
  ensureColumn(db, 'supplements', 'sold_out_date', 'TEXT');
  for (const col of ['notified_soon', 'notified_waiting', 'notified_rate', 'notified_late']) {
    ensureColumn(db, 'orders', col, 'INTEGER NOT NULL DEFAULT 0');
  }
  if (seed && db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n === 0) seedMenu(db);
  return db;
}
