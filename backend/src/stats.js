// Statistiques et fichier clients pour le patron. Tout est calculé à la demande depuis les commandes :
// « valide » = ni annulée, ni en attente de paiement en ligne.
import { addDays, daysBetween, localNow } from './time.js';
export { addDays };

const VALID = "status NOT IN ('cancelled','pending_payment')";
const IN_PROGRESS = "status IN ('new','preparing','ready')";
const round1 = (x) => Math.round(x * 10) / 10;

const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

// Décompose une ligne de commande en ventes par article.
// Formule : chaque élément compte pour popularité, sans répartir son prix. Moitié-moitié : ½ pour chacune.
function lineSales(configJson, quantity, unitPriceCents) {
  const cfg = JSON.parse(configJson);
  if (cfg.comboId !== undefined) return cfg.picks.map((id) => ({ itemId: id, units: quantity, revenue: 0 }));
  if (cfg.halfItemId) {
    const half = { units: quantity / 2, revenue: (unitPriceCents * quantity) / 2 };
    return [{ itemId: cfg.itemId, ...half }, { itemId: cfg.halfItemId, ...half }];
  }
  return [{ itemId: cfg.itemId, units: quantity, revenue: unitPriceCents * quantity }];
}

function itemSales(db, from, to) {
  const rows = db
    .prepare(
      `SELECT oi.config, oi.quantity, oi.unit_price_cents FROM order_items oi
       JOIN orders o ON o.id = oi.order_id WHERE o.${VALID} AND o.pickup_date BETWEEN ? AND ?`,
    )
    .all(from, to);
  const sales = new Map();
  for (const r of rows) {
    for (const s of lineSales(r.config, r.quantity, r.unit_price_cents)) {
      const cur = sales.get(s.itemId) ?? { units: 0, revenue_cents: 0 };
      cur.units += s.units;
      cur.revenue_cents += s.revenue;
      sales.set(s.itemId, cur);
    }
  }
  return sales;
}

const menuById = (db) => new Map(db.prepare('SELECT id, name, kind FROM menu_items').all().map((r) => [r.id, r]));

function ratingsByItem(db) {
  return new Map(
    db
      .prepare('SELECT item_id, AVG(rating) AS avg, COUNT(*) AS n FROM ratings GROUP BY item_id')
      .all()
      .map((r) => [r.item_id, { rating_avg: round1(r.avg), rating_count: r.n }]),
  );
}
export { ratingsByItem };

// Les 3 pizzas les plus commandées sur 30 jours. Rien tant qu'il y a trop peu de ventes pour que ce soit parlant.
export function bestSellers(db, today) {
  const menu = menuById(db);
  const sales = [...itemSales(db, addDays(today, -29), today)].filter(([id]) => menu.get(id)?.kind === 'pizza');
  const total = sales.reduce((n, [, s]) => n + s.units, 0);
  if (total < 10) return [];
  return sales
    .filter(([, s]) => s.units >= 2)
    .sort((a, b) => b[1].units - a[1].units)
    .slice(0, 3)
    .map(([id]) => id);
}

function totalsBetween(db, from, to) {
  const t = db
    .prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents),0) AS revenue, COALESCE(SUM(pizza_count),0) AS pizzas,
              COALESCE(SUM(discount_cents),0) AS discount FROM orders WHERE ${VALID} AND pickup_date BETWEEN ? AND ?`)
    .get(from, to);
  return {
    orders: t.orders,
    revenue_cents: t.revenue,
    pizzas: t.pizzas,
    discount_cents: t.discount,
    avg_basket_cents: t.orders ? Math.round(t.revenue / t.orders) : 0,
  };
}

function customerRows(db) {
  return db
    .prepare(
      `SELECT phone, COUNT(*) AS orders, SUM(total_cents) AS spent_cents, MIN(pickup_date) AS first_date,
              MAX(pickup_date) AS last_date,
              (SELECT customer_name FROM orders o2 WHERE o2.phone = o.phone ORDER BY created_at DESC LIMIT 1) AS name
       FROM orders o WHERE ${VALID} GROUP BY phone`,
    )
    .all();
}

function segmentOf(c, today) {
  if (c.orders >= 2 && daysBetween(c.last_date, today) > 30) return 'dormant';
  if (c.orders >= 3) return 'regular';
  if (c.orders === 1 && daysBetween(c.first_date, today) <= 30) return 'new';
  return 'occasional';
}

// Pizza préférée de chaque client (par téléphone).
function favoritesByPhone(db) {
  const menu = menuById(db);
  const rows = db
    .prepare(
      `SELECT o.phone, oi.config, oi.quantity, oi.unit_price_cents FROM order_items oi
       JOIN orders o ON o.id = oi.order_id WHERE o.${VALID}`,
    )
    .all();
  const perPhone = new Map();
  for (const r of rows) {
    const m = perPhone.get(r.phone) ?? new Map();
    for (const s of lineSales(r.config, r.quantity, r.unit_price_cents)) {
      if (menu.get(s.itemId)?.kind === 'pizza') m.set(s.itemId, (m.get(s.itemId) ?? 0) + s.units);
    }
    perPhone.set(r.phone, m);
  }
  return (phone, limit = 1) =>
    [...(perPhone.get(phone) ?? [])]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, units]) => ({ name: menu.get(id).name, units }));
}

export function listCustomers(db, config, now) {
  const today = localNow(config.timezone, now).date;
  const fav = favoritesByPhone(db);
  const notes = new Map(db.prepare('SELECT phone, note FROM customer_notes').all().map((r) => [r.phone, r.note]));
  return customerRows(db)
    .map((c) => ({
      ...c,
      avg_basket_cents: Math.round(c.spent_cents / c.orders),
      days_since_last: daysBetween(c.last_date, today),
      segment: segmentOf(c, today),
      favorite: fav(c.phone)[0]?.name ?? null,
      note: notes.get(c.phone) ?? '',
    }))
    .sort((a, b) => b.spent_cents - a.spent_cents);
}

export function customerDetail(db, config, now, phone) {
  const c = listCustomers(db, config, now).find((x) => x.phone === phone);
  if (!c) return null;
  const orders = db
    .prepare(
      `SELECT id, number, pickup_date, pickup_time, total_cents, status, payment_method FROM orders
       WHERE phone = ? AND ${VALID} ORDER BY pickup_date DESC, pickup_time DESC LIMIT 30`,
    )
    .all(phone)
    .map((o) => ({
      ...o,
      items: db.prepare('SELECT name, details, quantity FROM order_items WHERE order_id = ?').all(o.id),
    }));
  return { ...c, favorites: favoritesByPhone(db)(phone, 3), orders };
}

export function computeStats(db, config, now, days) {
  const today = localNow(config.timezone, now).date;
  const from = addDays(today, -(days - 1));
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const menu = menuById(db);
  const ratings = ratingsByItem(db);

  const orders = db
    .prepare(`SELECT pickup_date, pickup_time, total_cents, payment_method, phone FROM orders WHERE ${VALID} AND pickup_date BETWEEN ? AND ?`)
    .all(from, today);

  const daily = new Map();
  for (let d = from; d <= today; d = addDays(d, 1)) daily.set(d, { date: d, orders: 0, revenue_cents: 0 });
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0 }));
  const weekday = Array.from({ length: 7 }, (_, w) => ({ weekday: w, orders: 0, revenue_cents: 0, days: 0 }));
  for (const [d] of daily) weekday[weekdayOf(d)].days += 1;
  let online = 0;
  for (const o of orders) {
    const day = daily.get(o.pickup_date);
    day.orders += 1;
    day.revenue_cents += o.total_cents;
    hourly[Number(o.pickup_time.slice(0, 2))].orders += 1;
    const w = weekday[weekdayOf(o.pickup_date)];
    w.orders += 1;
    w.revenue_cents += o.total_cents;
    if (o.payment_method === 'online') online += 1;
  }

  const sales = itemSales(db, from, today);
  const topItems = [...sales]
    .map(([id, s]) => ({
      id,
      name: menu.get(id)?.name ?? `#${id}`,
      kind: menu.get(id)?.kind ?? 'autre',
      units: s.units,
      revenue_cents: s.revenue_cents,
      ...(ratings.get(id) ?? { rating_avg: null, rating_count: 0 }),
    }))
    .sort((a, b) => b.units - a.units)
    .slice(0, 10);

  // Clients
  const all = customerRows(db);
  const activePhones = new Set(orders.map((o) => o.phone));
  const inRange = all.filter((c) => activePhones.has(c.phone));
  const fresh = inRange.filter((c) => c.first_date >= from).length;

  const todayOrders = db
    .prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents),0) AS revenue, COALESCE(SUM(pizza_count),0) AS pizzas FROM orders WHERE ${VALID} AND pickup_date = ?`)
    .get(today);
  const inProgress = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE ${IN_PROGRESS}`).get().n;

  const rated = db.prepare('SELECT AVG(rating) AS avg, COUNT(*) AS n FROM ratings').get();
  const recent = db
    .prepare(`SELECT number, customer_name, feedback, pickup_date, id FROM orders WHERE feedback IS NOT NULL AND feedback != '' ORDER BY created_at DESC LIMIT 8`)
    .all()
    .map((o) => ({
      number: o.number,
      first_name: o.customer_name.split(' ')[0],
      comment: o.feedback,
      date: o.pickup_date,
      ratings: db
        .prepare('SELECT item_id, rating FROM ratings WHERE order_id = ?')
        .all(o.id)
        .map((r) => ({ name: menu.get(r.item_id)?.name ?? '?', rating: r.rating })),
    }));

  const loyalty = db.prepare('SELECT COUNT(CASE WHEN stamps > 0 THEN 1 END) AS members, COALESCE(SUM(rewards_used),0) AS redeemed FROM loyalty').get();
  const totals = totalsBetween(db, from, today);

  return {
    range: { from, to: today, days },
    today: { orders: todayOrders.orders, revenue_cents: todayOrders.revenue, pizzas: todayOrders.pizzas, in_progress: inProgress },
    totals: { ...totals, online_share: totals.orders ? online / totals.orders : 0 },
    previous: totalsBetween(db, prevFrom, prevTo),
    daily: [...daily.values()],
    hourly,
    weekday: weekday.map((w) => ({ ...w, avg_orders: w.days ? round1(w.orders / w.days) : 0 })),
    topItems,
    customers: {
      total: all.length,
      active: inRange.length,
      new: fresh,
      returning: inRange.length - fresh,
      repeat_rate: all.length ? all.filter((c) => c.orders >= 2).length / all.length : 0,
    },
    loyalty: { members: loyalty.members, rewards_redeemed: loyalty.redeemed },
    ratings: { average: rated.n ? round1(rated.avg) : null, count: rated.n, recent },
  };
}
