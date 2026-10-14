// Réglages que le patron change en direct (bouton « fermer », rush, capacité du four…).
const DEFAULTS = { orders_open: '1', rush_minutes: '0', max_pizzas_per_slot: '8', banner: '' };

export function readSettings(db) {
  const rows = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  const v = { ...DEFAULTS, ...rows };
  return {
    ordersOpen: v.orders_open === '1',
    rushMinutes: Number(v.rush_minutes),
    maxPizzasPerSlot: Number(v.max_pizzas_per_slot),
    banner: v.banner,
  };
}

// Renvoie un message d'erreur si une valeur est invalide, sinon null (et enregistre).
export function writeSettings(db, input) {
  const entries = [];
  if (input.ordersOpen !== undefined) entries.push(['orders_open', input.ordersOpen ? '1' : '0']);
  if (input.rushMinutes !== undefined) {
    const n = Number(input.rushMinutes);
    if (!Number.isInteger(n) || n < 0 || n > 90) return 'Délai supplémentaire invalide (0 à 90 min)';
    entries.push(['rush_minutes', String(n)]);
  }
  if (input.maxPizzasPerSlot !== undefined) {
    const n = Number(input.maxPizzasPerSlot);
    if (!Number.isInteger(n) || n < 0 || n > 100) return 'Capacité invalide (0 = illimité)';
    entries.push(['max_pizzas_per_slot', String(n)]);
  }
  if (input.banner !== undefined) {
    const s = String(input.banner).trim();
    if (s.length > 140) return 'Message trop long (140 caractères max)';
    entries.push(['banner', s]);
  }
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, val] of entries) upsert.run(k, val);
  return null;
}
