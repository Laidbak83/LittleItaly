// Réglages que le patron change en direct (bouton « fermer », rush, capacité du four…).
const DEFAULTS = { orders_open: '1', rush_minutes: '0', max_pizzas_per_slot: '8', banner: '', half_and_half: '0',
  featured_item_id: '', featured_price_cents: '', featured_note: '', featured_until: '' };

export function readSettings(db) {
  const rows = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  const v = { ...DEFAULTS, ...rows };
  return {
    ordersOpen: v.orders_open === '1',
    rushMinutes: Number(v.rush_minutes),
    maxPizzasPerSlot: Number(v.max_pizzas_per_slot),
    banner: v.banner,
    halfAndHalf: v.half_and_half === '1',
    featuredItemId: v.featured_item_id ? Number(v.featured_item_id) : null,
    featuredPriceCents: v.featured_price_cents === '' ? null : Number(v.featured_price_cents),
    featuredNote: v.featured_note,
    featuredUntil: v.featured_until || null,
  };
}

// Renvoie un message d'erreur si une valeur est invalide, sinon null (et enregistre).
export function writeSettings(db, input) {
  const entries = [];
  if (input.ordersOpen !== undefined) entries.push(['orders_open', input.ordersOpen ? '1' : '0']);
  if (input.halfAndHalf !== undefined) entries.push(['half_and_half', input.halfAndHalf ? '1' : '0']);
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
  // Pizza de la semaine : un article, un prix promo facultatif, une note, une date de fin facultative.
  if (input.featuredItemId !== undefined) {
    if (input.featuredItemId === null) {
      entries.push(['featured_item_id', ''], ['featured_price_cents', ''], ['featured_note', ''], ['featured_until', '']);
    } else {
      const id = Number(input.featuredItemId);
      if (!Number.isInteger(id) || !db.prepare('SELECT 1 FROM menu_items WHERE id = ?').get(id)) return 'Article introuvable';
      const price = input.featuredPriceCents;
      if (price !== null && price !== undefined && (!Number.isInteger(price) || price < 0)) return 'Prix promo invalide';
      const note = String(input.featuredNote ?? '').trim();
      if (note.length > 100) return 'Texte trop long (100 caractères max)';
      const until = input.featuredUntil ? String(input.featuredUntil) : '';
      if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) return 'Date de fin invalide';
      entries.push(
        ['featured_item_id', String(id)],
        ['featured_price_cents', price === null || price === undefined ? '' : String(price)],
        ['featured_note', note],
        ['featured_until', until],
      );
    }
  }
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, val] of entries) upsert.run(k, val);
  return null;
}

// Pizza de la semaine active aujourd'hui (date locale AAAA-MM-JJ), ou null.
export function activeFeatured(db, settings, today) {
  if (!settings.featuredItemId) return null;
  if (settings.featuredUntil && today > settings.featuredUntil) return null;
  const item = db.prepare('SELECT id FROM menu_items WHERE id = ? AND available = 1').get(settings.featuredItemId);
  if (!item) return null;
  return {
    itemId: item.id,
    priceCents: settings.featuredPriceCents,
    note: settings.featuredNote,
    until: settings.featuredUntil,
  };
}
