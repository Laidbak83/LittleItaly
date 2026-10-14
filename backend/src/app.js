import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import Stripe from 'stripe';
import { addDays, availableSlots, daysBetween, localNow, localToDate, weekdayOf } from './time.js';
import { bestOffer, buildQuote, isFirstOrder, referralCodeFor } from './ordering.js';
import { createNotifier } from './notifier.js';
import { computeKitchen, typicalPrepMinutes } from './kitchen.js';
import { computeForecast } from './forecast.js';
import { audience, nextAllowedAt, SEGMENTS } from './campaigns.js';
import { OrderError, priceLine, shapeItem } from './pricing.js';
import { activeFeatured, readSettings, writeSettings } from './settings.js';
import { bestSellers, computeStats, customerDetail, listCustomers, ratingsByItem } from './stats.js';
import { addStamps, consumeReward, isValidLoyaltyId, loyaltyStatus, REWARD_TARGET, refundReward } from './loyalty.js';

const STATUSES = ['new', 'preparing', 'ready', 'done', 'cancelled'];
const KINDS = ['pizza', 'boisson', 'dessert', 'autre'];
const PENDING_PAYMENT_TTL_MS = 30 * 60 * 1000;
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function loadOrder(db, id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;
  order.items = db
    .prepare('SELECT name, details, quantity, unit_price_cents, config FROM order_items WHERE order_id = ?')
    .all(id)
    .map((i) => ({ ...i, config: JSON.parse(i.config) }));
  return order;
}

// Ne jamais exposer le jeton push, l'identifiant Stripe ni l'identifiant de fidélité.
const publicOrder = ({ push_token, stripe_payment_intent, loyalty_id, stamps_credited, ...rest }) => rest;

// Pizzas qu'un client peut noter : celles de sa commande (entières, moitiés, ou choisies dans une formule).
function rateableItems(db, order) {
  const ids = new Set();
  for (const it of order.items) {
    const c = it.config;
    if (c.comboId !== undefined) c.picks.forEach((id) => ids.add(id));
    else {
      ids.add(c.itemId);
      if (c.halfItemId) ids.add(c.halfItemId);
    }
  }
  const get = db.prepare("SELECT id, name FROM menu_items WHERE id = ? AND kind = 'pizza'");
  return [...ids].map((id) => get.get(id)).filter(Boolean).map((r) => ({ itemId: r.id, name: r.name }));
}

const transaction = (db, fn) => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

export async function buildApp({ db, config, stripe, webPush, fetchImpl = fetch, now = () => new Date(), logger = false }) {
  const app = Fastify({ logger });
  const notifier = createNotifier({ db, config, now, fetchImpl, webPush, log: (...a) => app.log.warn(a.join(' ')) });
  app.decorate('notifier', notifier); // le serveur appelle notifier.tick() toutes les 30 s
  const stripeClient = stripe ?? (config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null);
  const onlinePayment = Boolean(stripeClient && config.stripePublishableKey);

  const uploadsDir = resolve(
    config.uploadsDir || (config.dbPath === ':memory:' ? join(tmpdir(), 'littleitaly-uploads') : join(dirname(config.dbPath), 'uploads')),
  );
  mkdirSync(uploadsDir, { recursive: true });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, { global: false });
  await app.register(fastifyStatic, { root: publicDir });
  await app.register(fastifyStatic, { root: uploadsDir, prefix: '/uploads/', decorateReply: false });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof OrderError) return reply.code(400).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Erreur interne' });
  });

  // Corps brut conservé pour vérifier la signature du webhook Stripe.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      req.rawBody = body;
      done(null, body ? JSON.parse(body) : {});
    } catch (err) {
      err.statusCode = 400;
      done(err);
    }
  });

  const requireAdmin = async (req, reply) => {
    if (!config.adminToken) return reply.code(503).send({ error: 'ADMIN_TOKEN non configuré' });
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!safeEqual(token, config.adminToken)) return reply.code(401).send({ error: 'Non autorisé' });
  };

  // Commandes en ligne jamais payées : on les annule, on rend la récompense et on bloque le paiement.
  const expireStale = () => {
    const cutoff = new Date(now().getTime() - PENDING_PAYMENT_TTL_MS).toISOString();
    const stale = db
      .prepare("SELECT id, reward_used, loyalty_id, stripe_payment_intent FROM orders WHERE status = 'pending_payment' AND created_at < ?")
      .all(cutoff);
    for (const o of stale) {
      db.prepare("UPDATE orders SET status = 'cancelled', reward_used = 0 WHERE id = ?").run(o.id);
      if (o.reward_used && o.loyalty_id) refundReward(db, o.loyalty_id);
      if (o.stripe_payment_intent && stripeClient) {
        Promise.resolve(stripeClient.paymentIntents.cancel(o.stripe_payment_intent)).catch(() => {});
      }
    }
  };

  // Pizzas déjà réservées par créneau aujourd'hui (capacité du four).
  const bookedByTime = (date) =>
    new Map(
      db
        .prepare("SELECT pickup_time, SUM(pizza_count) AS n FROM orders WHERE pickup_date = ? AND status != 'cancelled' GROUP BY pickup_time")
        .all(date)
        .map((r) => [r.pickup_time, r.n]),
    );

  const closureFor = (date) => db.prepare('SELECT reason FROM closures WHERE ? BETWEEN date_from AND date_to LIMIT 1').get(date);

  // Créneaux de retrait d'un jour (aujourd'hui par défaut). Aujourd'hui : délai de préparation, mode rush, bouton « fermé ».
  // Autres jours : tous les créneaux d'ouverture. Dans tous les cas : capacité du four et fermetures exceptionnelles.
  const slotsFor = (pizzas = 1, requestedDate = null) => {
    const settings = readSettings(db);
    const today = localNow(config.timezone, now()).date;
    const date = requestedDate ?? today;
    const base = { date, slots: [], maxPizzasPerSlot: settings.maxPizzasPerSlot, offers: {}, closed: null };
    if (date < today || date > addDays(today, settings.maxAdvanceDays)) return base;
    const closure = closureFor(date);
    if (closure) return { ...base, closed: closure.reason || 'Fermé ce jour-là' };
    if (!settings.ordersOpen && date === today) return base;
    const result = availableSlots(config, now(), {
      date,
      extraLeadMinutes: settings.rushMinutes,
      leadMinutes: settings.leadMinutes ?? config.leadMinutes,
      maxPerSlot: settings.maxPizzasPerSlot,
      booked: bookedByTime(date),
      pizzas,
    });
    const offers = {};
    for (const slot of result.slots) {
      const o = bestOffer(db, date, slot);
      if (o) offers[slot] = { label: o.label, discount_cents: o.discount_cents, min_order_cents: o.min_order_cents };
    }
    return { ...base, ...result, offers };
  };

  const todayDate = () => localNow(config.timezone, now()).date;
  const featuredNow = () => activeFeatured(db, readSettings(db), todayDate());

  const eur = (c) => `${(c / 100).toFixed(2).replace('.', ',')} €`;
  const presentOrder = (order, settings = readSettings(db)) => ({
    ...publicOrder(order),
    pickup_at: localToDate(config.timezone, order.pickup_date, order.pickup_time).toISOString(),
    pickup_in_days: daysBetween(todayDate(), order.pickup_date), // 0 = aujourd'hui, 1 = demain…
    // Pizzas à régler au retrait, pas encore lancées : la cuisine attend le « J'arrive » du client.
    hold_until_arrival: settings.holdUnpaid && order.payment_status === 'unpaid' && order.status === 'new' && !order.arrival_eta_at,
  });

  // Best-sellers : calcul léger mais fréquent (chaque ouverture de la carte) → mémorisé 5 min.
  let bsCache = { until: 0, date: '', ids: [] };
  const bestSellersNow = () => {
    const t = now().getTime();
    const date = todayDate();
    if (t >= bsCache.until || bsCache.date !== date) bsCache = { until: t + 5 * 60 * 1000, date, ids: bestSellers(db, date) };
    return bsCache.ids;
  };

  // ---------- Public ----------
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/config', async () => {
    const s = readSettings(db);
    return {
      onlinePaymentEnabled: onlinePayment,
      stripePublishableKey: onlinePayment ? config.stripePublishableKey : null,
      ordersOpen: s.ordersOpen,
      rewardTarget: REWARD_TARGET,
      info: s.info,
      hours: config.hoursByWeekday, // horaires de retrait par jour (0 = dimanche)
      closures: db.prepare('SELECT date_from, date_to, reason FROM closures WHERE date_to >= ? ORDER BY date_from').all(todayDate()),
      maxAdvanceDays: s.maxAdvanceDays,
      referral: s.referralStamps > 0 ? { stamps: s.referralStamps } : null,
      welcome: s.welcomeCents > 0 ? { cents: s.welcomeCents, min_cents: s.welcomeMinCents } : null,
      holdUnpaid: s.holdUnpaid,
      prepayOverCents: onlinePayment ? s.prepayOverCents : 0,
    };
  });

  app.get('/api/menu', async () => {
    const featured = featuredNow();
    const ratings = ratingsByItem(db);
    const items = db
      .prepare('SELECT * FROM menu_items WHERE available = 1 ORDER BY position, id')
      .all()
      .map((row) => {
        const item = shapeItem(row);
        const promo = featured && featured.itemId === item.id && featured.priceCents !== null;
        return {
          ...item,
          sold_out: row.sold_out_date === todayDate(),
          price_cents: promo ? featured.priceCents : item.price_cents,
          regular_price_cents: promo ? item.price_cents : null,
          ...(ratings.get(item.id) ?? { rating_avg: null, rating_count: 0 }),
        };
      });
    const supplements = db
      .prepare('SELECT id, name, price_cents, sold_out_date FROM supplements WHERE available = 1 ORDER BY id')
      .all()
      .map(({ sold_out_date, ...sp }) => ({ ...sp, sold_out: sold_out_date === todayDate() }));
    const combos = db
      .prepare('SELECT id, name, description, price_cents, slots FROM combos WHERE available = 1 ORDER BY id')
      .all()
      .map((c) => ({ ...c, slots: JSON.parse(c.slots) }));
    const settings = readSettings(db);
    return {
      items,
      supplements,
      combos,
      banner: settings.banner,
      halfAndHalf: settings.halfAndHalf,
      featured: featured ? { itemId: featured.itemId, note: featured.note, until: featured.until } : null,
      bestSellers: bestSellersNow().filter((id) => items.some((i) => i.id === id)),
    };
  });

  app.get('/api/slots', async (req, reply) => {
    expireStale();
    const date = req.query.date ? String(req.query.date) : null;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({ error: 'Date invalide' });
    const settings = readSettings(db);
    const today = todayDate();
    const days = [];
    for (let i = 0; i <= settings.maxAdvanceDays; i++) {
      const d = addDays(today, i);
      const closure = closureFor(d);
      const hasHours = (config.hoursByWeekday[weekdayOf(d)] ?? []).length > 0;
      days.push({ date: d, closed: closure ? closure.reason || 'Fermé' : hasHours ? null : 'Fermé' });
    }
    return { ...slotsFor(Number(req.query.pizzas) || 1, date), days };
  });

  app.get('/api/loyalty/:id', async (req, reply) => {
    if (!isValidLoyaltyId(req.params.id)) return reply.code(400).send({ error: 'Identifiant invalide' });
    expireStale();
    const settings = readSettings(db);
    const device = db.prepare('SELECT marketing FROM devices WHERE loyalty_id = ?').get(req.params.id);
    return {
      ...loyaltyStatus(db, req.params.id),
      referral_code: settings.referralStamps > 0 ? referralCodeFor(db, req.params.id) : null,
      referral_stamps: settings.referralStamps,
      welcome: settings.welcomeCents > 0 && isFirstOrder(db, req.params.id, null) ? { cents: settings.welcomeCents, min_cents: settings.welcomeMinCents } : null,
      marketing: Boolean(device?.marketing),
    };
  });

  const cleanPhone = (v) => String(v ?? '').replace(/[\s.-]/g, '');
  const quoteInput = (b) => ({ ...b, phone: /^\+?\d{10,14}$/.test(cleanPhone(b.phone)) ? cleanPhone(b.phone) : null });
  const asQuote = (q) => ({
    date: q.date,
    subtotal_cents: q.subtotal,
    reward_cents: q.reward,
    welcome_cents: q.welcome,
    offer: q.offer,
    total_cents: q.total,
    requires_online: q.requiresOnline,
    referral_ok: Boolean(q.referredBy),
    pizzas: q.pizzaCount,
  });

  // Devis : le total EXACT (remises comprises) que l'appli affiche avant de valider.
  app.post('/api/quote', { config: { rateLimit: { max: 300, timeWindow: '1 hour' } } }, async (req) => {
    expireStale();
    return asQuote(buildQuote({ db, today: todayDate(), onlinePayment }, quoteInput(req.body ?? {})));
  });

  // Mémorise le jeton de notification et l'accord du client pour recevoir des offres (identifié par sa carte de fidélité).
  app.put('/api/devices/:id', { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req, reply) => {
    if (!isValidLoyaltyId(req.params.id)) return reply.code(400).send({ error: 'Identifiant invalide' });
    const b = req.body ?? {};
    const token = typeof b.pushToken === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(b.pushToken) ? b.pushToken.slice(0, 200) : null;
    const at = now().toISOString();
    db.prepare(
      `INSERT INTO devices (loyalty_id, push_token, marketing, marketing_at, updated_at) VALUES (?,?,0,NULL,?)
       ON CONFLICT(loyalty_id) DO UPDATE SET push_token = COALESCE(?, push_token), updated_at = excluded.updated_at`,
    ).run(req.params.id, token, at, token);
    if (typeof b.marketing === 'boolean') {
      db.prepare('UPDATE devices SET marketing = ?, marketing_at = ? WHERE loyalty_id = ?').run(b.marketing ? 1 : 0, at, req.params.id);
    }
    return { ok: true };
  });

  app.post(
    '/api/orders',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const b = req.body ?? {};
      const name = String(b.customerName ?? '').trim();
      const phone = cleanPhone(b.phone);
      const note = String(b.note ?? '').trim().slice(0, 300);
      if (name.length < 2 || name.length > 60) return reply.code(400).send({ error: 'Nom invalide' });
      if (!/^\+?\d{10,14}$/.test(phone)) return reply.code(400).send({ error: 'Téléphone invalide' });
      if (!['online', 'on_pickup'].includes(b.paymentMethod))
        return reply.code(400).send({ error: 'Mode de paiement invalide' });
      if (b.paymentMethod === 'online' && !onlinePayment)
        return reply.code(400).send({ error: 'Paiement en ligne indisponible' });
      if (b.loyaltyId != null && !isValidLoyaltyId(b.loyaltyId))
        return reply.code(400).send({ error: 'Identifiant de fidélité invalide' });
      if (b.useReward && !b.loyaltyId) return reply.code(400).send({ error: 'Carte de fidélité requise' });

      expireStale();
      const today = todayDate();
      const quote = buildQuote({ db, today, onlinePayment }, { ...b, phone });
      const settings = readSettings(db);
      if (quote.date === today && !settings.ordersOpen)
        return reply.code(423).send({ error: 'Les commandes sont momentanément fermées' });
      if (b.paymentMethod === 'on_pickup' && quote.requiresOnline)
        return reply.code(400).send({ error: `Au-delà de ${eur(settings.prepayOverCents)}, le paiement en ligne est demandé`, requires_online: true });

      const total = quote.total;
      const id = randomUUID();
      const online = b.paymentMethod === 'online';
      const pushToken = typeof b.pushToken === 'string' ? b.pushToken.slice(0, 200) : null;
      const createdAt = now().toISOString();

      transaction(db, () => {
        const { date, slots, closed } = slotsFor(quote.pizzaCount, quote.date);
        if (!slots.includes(b.pickupTime)) {
          if (closed) throw new OrderError(`Le restaurant est fermé ce jour-là (${closed})`);
          const full =
            quote.pizzaCount > 0 &&
            availableSlots(config, now(), { date, extraLeadMinutes: settings.rushMinutes, leadMinutes: settings.leadMinutes ?? config.leadMinutes }).slots.includes(b.pickupTime);
          throw new OrderError(full ? 'Ce créneau est complet, choisissez une autre heure' : 'Créneau indisponible, choisissez une autre heure');
        }
        if (b.useReward) {
          if (loyaltyStatus(db, b.loyaltyId).rewardsAvailable < 1) throw new OrderError('Aucune pizza offerte disponible');
          consumeReward(db, b.loyaltyId);
        }
        const { n } = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE pickup_date = ?').get(date);
        db.prepare(
          `INSERT INTO orders (id, number, customer_name, phone, note, pickup_date, pickup_time,
             payment_method, payment_status, status, total_cents, discount_cents, offer_discount_cents, offer_label,
             welcome_discount_cents, referred_by, pizza_count, loyalty_id, reward_used, push_token, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          id, n + 1, name, phone, note, date, b.pickupTime, b.paymentMethod,
          online ? 'pending' : 'unpaid', online ? 'pending_payment' : 'new',
          total, quote.reward, quote.offer?.cents ?? 0, quote.offer?.label ?? null,
          quote.welcome, quote.referredBy, quote.pizzaCount, b.loyaltyId ?? null, b.useReward ? 1 : 0, pushToken, createdAt,
        );
        const insertLine = db.prepare(
          'INSERT INTO order_items (order_id, name, details, quantity, unit_price_cents, config) VALUES (?,?,?,?,?,?)',
        );
        for (const l of quote.lines) insertLine.run(id, l.name, l.details, l.quantity, l.unitCents, JSON.stringify(l.config));
      });
      if (b.loyaltyId && pushToken) {
        db.prepare(
          `INSERT INTO devices (loyalty_id, push_token, updated_at) VALUES (?,?,?)
           ON CONFLICT(loyalty_id) DO UPDATE SET push_token = excluded.push_token, updated_at = excluded.updated_at`,
        ).run(b.loyaltyId, pushToken, createdAt);
      }

      let clientSecret = null;
      if (online && total > 0) {
        try {
          const intent = await stripeClient.paymentIntents.create({
            amount: total,
            currency: 'eur',
            automatic_payment_methods: { enabled: true },
            metadata: { orderId: id },
          });
          clientSecret = intent.client_secret;
          db.prepare('UPDATE orders SET stripe_payment_intent = ? WHERE id = ?').run(intent.id, id);
        } catch (err) {
          db.prepare("UPDATE orders SET status = 'cancelled', reward_used = 0 WHERE id = ?").run(id);
          if (b.useReward) refundReward(db, b.loyaltyId);
          req.log.error(err);
          return reply.code(502).send({ error: 'Le paiement en ligne a échoué, réessayez' });
        }
      } else if (online) {
        // Total à 0 € (pizza offerte seule) : rien à payer en ligne.
        db.prepare("UPDATE orders SET payment_status = 'paid', status = 'new' WHERE id = ?").run(id);
      }
      // Arrivée en cuisine : tout de suite au retrait ; après confirmation du paiement pour le paiement en ligne.
      if (!online || total === 0) notifier.orderPlaced(loadOrder(db, id));
      return reply.code(201).send({ order: presentOrder(loadOrder(db, id)), clientSecret });
    },
  );

  // « J'arrive » : le client prévient la cuisine (dans 5, 10, 15 ou 20 min, ou « je suis là »).
  app.post('/api/orders/:id/arrival', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, reply) => {
    const order = loadOrder(db, req.params.id);
    if (!order) return reply.code(404).send({ error: 'Commande introuvable' });
    if (!['new', 'preparing', 'ready'].includes(order.status)) return reply.code(409).send({ error: "Cette commande n'est plus en cours" });
    const minutes = Number(req.body?.minutes);
    if (![0, 5, 10, 15, 20].includes(minutes)) return reply.code(400).send({ error: 'Délai invalide' });
    if (!order.arrival_here) {
      db.prepare('UPDATE orders SET arrival_eta_at = ?, arrival_here = ? WHERE id = ?').run(
        new Date(now().getTime() + minutes * 60000).toISOString(), minutes === 0 ? 1 : 0, order.id,
      );
    }
    return { order: presentOrder(loadOrder(db, order.id)) };
  });

  // L'identifiant est un UUID aléatoire : il sert de "lien secret" de suivi.
  app.get('/api/orders/:id', async (req, reply) => {
    const order = loadOrder(db, req.params.id);
    if (!order) return reply.code(404).send({ error: 'Commande introuvable' });
    const result = presentOrder(order);
    if (order.status === 'done') {
      result.rateable = rateableItems(db, order);
      result.ratings = db.prepare('SELECT item_id AS itemId, rating FROM ratings WHERE order_id = ?').all(order.id);
    }
    return { order: result };
  });

  // Avis sur les pizzas : possible une seule fois par pizza, après le retrait de la commande.
  app.post(
    '/api/orders/:id/ratings',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const order = loadOrder(db, req.params.id);
      if (!order) return reply.code(404).send({ error: 'Commande introuvable' });
      if (order.status !== 'done') return reply.code(409).send({ error: 'Vous pourrez noter vos pizzas après le retrait de la commande' });
      const allowed = new Set(rateableItems(db, order).map((r) => r.itemId));
      const list = req.body?.ratings;
      if (!Array.isArray(list) || list.length === 0 || list.length > 10) return reply.code(400).send({ error: 'Avis invalide' });
      const seen = new Set();
      for (const r of list) {
        if (!Number.isInteger(r?.itemId) || !allowed.has(r.itemId) || seen.has(r.itemId)) return reply.code(400).send({ error: 'Pizza invalide' });
        if (!Number.isInteger(r.rating) || r.rating < 1 || r.rating > 5) return reply.code(400).send({ error: 'Note invalide (1 à 5)' });
        seen.add(r.itemId);
      }
      const done = new Set(db.prepare('SELECT item_id FROM ratings WHERE order_id = ?').all(order.id).map((r) => r.item_id));
      if (list.some((r) => done.has(r.itemId))) return reply.code(409).send({ error: 'Vous avez déjà noté cette pizza' });
      const comment = String(req.body?.comment ?? '').trim().slice(0, 300);
      transaction(db, () => {
        const insert = db.prepare('INSERT INTO ratings (order_id, item_id, rating, created_at) VALUES (?,?,?,?)');
        for (const r of list) insert.run(order.id, r.itemId, r.rating, now().toISOString());
        if (comment && !order.feedback) db.prepare('UPDATE orders SET feedback = ? WHERE id = ?').run(comment, order.id);
      });
      return reply.code(201).send({ ok: true });
    },
  );

  // ---------- Stripe ----------
  app.post('/api/stripe/webhook', async (req, reply) => {
    if (!stripeClient || !config.stripeWebhookSecret) return reply.code(503).send({ error: 'Stripe non configuré' });
    let event;
    try {
      event = stripeClient.webhooks.constructEvent(
        req.rawBody, req.headers['stripe-signature'], config.stripeWebhookSecret,
      );
    } catch {
      return reply.code(400).send({ error: 'Signature invalide' });
    }
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const orderId = pi.metadata?.orderId;
      const res = db
        .prepare("UPDATE orders SET payment_status = 'paid', status = 'new' WHERE id = ? AND status = 'pending_payment'")
        .run(orderId);
      if (res.changes > 0) notifier.orderPlaced(loadOrder(db, orderId));
      if (res.changes === 0) {
        // Paiement arrivé après l'annulation de la commande : on rembourse.
        const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
        if (order?.status === 'cancelled' && stripeClient.refunds) {
          try {
            await stripeClient.refunds.create({ payment_intent: pi.id });
          } catch (err) {
            req.log.error(err);
          }
        }
      }
    }
    return { received: true };
  });

  // ---------- Admin (Olivier) ----------
  app.register(async (admin) => {
    admin.addHook('preHandler', requireAdmin);

    admin.get('/orders', async () => {
      expireStale();
      const settings = readSettings(db);
      const today = localNow(config.timezone, now()).date;
      const rows = db
        .prepare(
          `SELECT id FROM orders
           WHERE status != 'pending_payment'
             AND (pickup_date = ? OR status IN ('new','preparing','ready'))
           ORDER BY pickup_date, pickup_time, number`,
        )
        .all(today);
      return {
        now: now().toISOString(),
        typical_prep_minutes: typicalPrepMinutes(db, config, now()),
        orders: rows.map((r) => presentOrder(loadOrder(db, r.id), settings)),
      };
    });

    admin.patch('/orders/:id/status', async (req, reply) => {
      const { status } = req.body ?? {};
      if (!STATUSES.includes(status)) return reply.code(400).send({ error: 'Statut invalide' });
      const order = loadOrder(db, req.params.id);
      if (!order || order.status === 'pending_payment') return reply.code(404).send({ error: 'Commande introuvable' });
      if (order.status === 'cancelled') return reply.code(409).send({ error: 'Commande déjà annulée' });

      const changed = status !== order.status;
      const referralStamps = readSettings(db).referralStamps;
      let referralReward = false;
      transaction(db, () => {
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
        // Chronométrage : on garde la 1re fois que chaque étape est atteinte.
        const stamp = { preparing: 'preparing_at', ready: 'ready_at', done: 'done_at' }[status];
        if (stamp) db.prepare(`UPDATE orders SET ${stamp} = COALESCE(${stamp}, ?) WHERE id = ?`).run(now().toISOString(), order.id);
        if (status === 'cancelled' && order.reward_used && order.loyalty_id) {
          refundReward(db, order.loyalty_id);
          db.prepare('UPDATE orders SET reward_used = 0 WHERE id = ?').run(order.id);
        }
        // Les tampons sont crédités au retrait de la commande, une seule fois.
        if (status === 'done' && order.loyalty_id && !order.stamps_credited) {
          addStamps(db, order.loyalty_id, order.pizza_count - (order.reward_used ? 1 : 0));
          db.prepare('UPDATE orders SET stamps_credited = 1 WHERE id = ?').run(order.id);
        }
        // Parrainage : le parrain gagne des tampons quand son filleul retire sa 1re commande (une seule fois).
        if (status === 'done' && order.referred_by && !order.referral_credited && referralStamps > 0) {
          addStamps(db, order.referred_by, referralStamps);
          db.prepare('UPDATE orders SET referral_credited = 1 WHERE id = ?').run(order.id);
          referralReward = true;
        }
      });
      if (changed) notifier.statusChanged(order, status);
      if (referralReward) notifier.referralRewarded(order.referred_by, referralStamps);
      return { order: publicOrder(loadOrder(db, order.id)) };
    });

    admin.get('/stats', async (req, reply) => {
      const days = req.query.days === undefined ? 30 : Number(req.query.days);
      if (!Number.isInteger(days) || days < 1 || days > 365) return reply.code(400).send({ error: 'Période invalide (1 à 365 jours)' });
      return { ...computeStats(db, config, now(), days), kitchen: computeKitchen(db, config, now(), days) };
    });

    admin.get('/customers', async () => ({ customers: listCustomers(db, config, now()) }));
    admin.get('/customers/:phone', async (req, reply) => {
      const c = customerDetail(db, config, now(), req.params.phone);
      return c ?? reply.code(404).send({ error: 'Client introuvable' });
    });
    admin.put('/customers/:phone/note', async (req, reply) => {
      if (!/^\+?\d{10,14}$/.test(req.params.phone)) return reply.code(400).send({ error: 'Numéro invalide' });
      const note = String(req.body?.note ?? '').trim().slice(0, 500);
      db.prepare('INSERT INTO customer_notes (phone, note) VALUES (?,?) ON CONFLICT(phone) DO UPDATE SET note = excluded.note').run(req.params.phone, note);
      return { ok: true };
    });

    // ----- Offres heures creuses -----
    const hhmm = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
    const validateOffer = (o) => {
      const label = String(o.label ?? '').trim();
      if (!label || label.length > 40) return "Nom de l'offre invalide (40 caractères max)";
      if (!hhmm(o.startTime) || !hhmm(o.endTime) || o.startTime >= o.endTime) return 'Heures invalides (le début doit précéder la fin)';
      if (!Array.isArray(o.weekdays) || o.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Jours invalides';
      if (!Number.isInteger(o.discountCents) || o.discountCents < 1 || o.discountCents > 2000) return 'Remise invalide (0,01 à 20 €)';
      if (!Number.isInteger(o.minOrderCents) || o.minOrderCents < 0 || o.minOrderCents > 10000) return 'Commande minimum invalide';
      return null;
    };
    const offerInput = (b, prev = null) => ({
      label: b.label ?? prev?.label,
      startTime: b.startTime ?? prev?.start_time,
      endTime: b.endTime ?? prev?.end_time,
      weekdays: b.weekdays ?? (prev ? (prev.weekdays ? prev.weekdays.split(',').map(Number) : []) : []),
      discountCents: b.discountCents ?? prev?.discount_cents,
      minOrderCents: b.minOrderCents ?? prev?.min_order_cents ?? 0,
    });
    const csvDays = (days) => [...new Set(days)].sort().join(',');
    admin.get('/offers', async () => ({ offers: db.prepare('SELECT * FROM slot_offers ORDER BY start_time, id').all() }));
    admin.post('/offers', async (req, reply) => {
      const o = offerInput(req.body ?? {});
      const error = validateOffer(o);
      if (error) return reply.code(400).send({ error });
      const { lastInsertRowid } = db
        .prepare('INSERT INTO slot_offers (label, start_time, end_time, weekdays, discount_cents, min_order_cents) VALUES (?,?,?,?,?,?)')
        .run(o.label.trim(), o.startTime, o.endTime, csvDays(o.weekdays), o.discountCents, o.minOrderCents);
      return reply.code(201).send({ id: Number(lastInsertRowid) });
    });
    admin.patch('/offers/:id', async (req, reply) => {
      const row = db.prepare('SELECT * FROM slot_offers WHERE id = ?').get(req.params.id);
      if (!row) return reply.code(404).send({ error: 'Offre introuvable' });
      const o = offerInput(req.body ?? {}, row);
      const error = validateOffer(o);
      if (error) return reply.code(400).send({ error });
      const active = req.body?.active === undefined ? row.active : req.body.active ? 1 : 0;
      db.prepare('UPDATE slot_offers SET label=?, start_time=?, end_time=?, weekdays=?, discount_cents=?, min_order_cents=?, active=? WHERE id=?')
        .run(o.label.trim(), o.startTime, o.endTime, csvDays(o.weekdays), o.discountCents, o.minOrderCents, active, row.id);
      return { ok: true };
    });
    admin.delete('/offers/:id', async (req) => {
      db.prepare('DELETE FROM slot_offers WHERE id = ?').run(req.params.id);
      return { ok: true };
    });

    // ----- Fermetures exceptionnelles (congés, jours fériés) -----
    admin.get('/closures', async () => ({
      closures: db.prepare('SELECT * FROM closures WHERE date_to >= ? ORDER BY date_from').all(todayDate()),
    }));
    admin.post('/closures', async (req, reply) => {
      const b = req.body ?? {};
      const ok = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
      if (!ok(b.dateFrom) || !ok(b.dateTo) || b.dateFrom > b.dateTo) return reply.code(400).send({ error: 'Dates invalides (le début doit précéder la fin)' });
      const { lastInsertRowid } = db
        .prepare('INSERT INTO closures (date_from, date_to, reason) VALUES (?,?,?)')
        .run(b.dateFrom, b.dateTo, String(b.reason ?? '').trim().slice(0, 80));
      return reply.code(201).send({ id: Number(lastInsertRowid) });
    });
    admin.delete('/closures/:id', async (req) => {
      db.prepare('DELETE FROM closures WHERE id = ?').run(req.params.id);
      return { ok: true };
    });

    admin.get('/forecast', async () => computeForecast(db, config, now()));

    // QR code (SVG) pour les affiches, autocollants de boîtes et flyers.
    admin.get('/qr', async (req, reply) => {
      const url = String(req.query.url ?? '');
      if (!/^https?:\/\/.{3,300}$/.test(url)) return reply.code(400).send({ error: 'Adresse invalide' });
      return reply.type('image/svg+xml').send(await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
    });

    // ----- Offres envoyées par notification (clients ayant donné leur accord) -----
    admin.get('/campaigns', async () => ({
      segments: Object.entries(SEGMENTS).map(([key, label]) => ({ key, label, count: audience(db, config, now(), key).length })),
      history: db.prepare('SELECT * FROM campaigns ORDER BY sent_at DESC LIMIT 10').all(),
      next_allowed_at: nextAllowedAt(db),
    }));
    admin.post('/campaigns', async (req, reply) => {
      const b = req.body ?? {};
      const title = String(b.title ?? '').trim(), body = String(b.body ?? '').trim();
      if (!SEGMENTS[b.segment]) return reply.code(400).send({ error: 'Destinataires invalides' });
      if (!title || title.length > 50 || !body || body.length > 140) return reply.code(400).send({ error: 'Titre (50 caractères max) et message (140 max) requis' });
      const next = nextAllowedAt(db);
      if (next && Date.parse(next) > now().getTime()) {
        return reply.code(409).send({ error: "Une offre a déjà été envoyée récemment : on évite d'envahir les téléphones.", next_allowed_at: next });
      }
      const recipients = audience(db, config, now(), b.segment);
      if (!recipients.length) return reply.code(400).send({ error: "Aucun client ne correspond : il faut qu'ils aient accepté les offres dans l'appli." });
      await notifier.sendCampaign(recipients, title, body);
      db.prepare('INSERT INTO campaigns (sent_at, segment, title, body, recipients) VALUES (?,?,?,?,?)').run(now().toISOString(), b.segment, title, body, recipients.length);
      return reply.code(201).send({ recipients: recipients.length });
    });

    // Notifications sur le téléphone / la tablette d'Olivier (écran admin installé).
    admin.get('/push/key', async () => ({
      publicKey: notifier.vapidPublicKey(),
      devices: db.prepare('SELECT COUNT(*) AS n FROM owner_subscriptions').get().n,
    }));
    admin.post('/push/subscribe', async (req, reply) => {
      const sub = req.body?.subscription;
      const ok =
        typeof sub?.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 2000 &&
        typeof sub.keys?.p256dh === 'string' && typeof sub.keys?.auth === 'string';
      if (!ok) return reply.code(400).send({ error: 'Abonnement invalide' });
      db.prepare(
        `INSERT INTO owner_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?,?,?,?)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
      ).run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, now().toISOString());
      return reply.code(201).send({ ok: true });
    });
    admin.post('/push/unsubscribe', async (req) => {
      db.prepare('DELETE FROM owner_subscriptions WHERE endpoint = ?').run(String(req.body?.endpoint ?? ''));
      return { ok: true };
    });
    admin.post('/push/test', async () => ({ sent: await notifier.sendTest() }));

    admin.get('/settings', async () => ({ ...readSettings(db), defaultLeadMinutes: config.leadMinutes }));
    admin.put('/settings', async (req, reply) => {
      const error = writeSettings(db, req.body ?? {});
      if (error) return reply.code(400).send({ error });
      return readSettings(db);
    });

    admin.get('/menu', async () => ({
      items: db.prepare('SELECT * FROM menu_items ORDER BY position, id').all(),
      supplements: db.prepare('SELECT * FROM supplements ORDER BY id').all(),
      combos: db.prepare('SELECT * FROM combos ORDER BY id').all().map((c) => ({ ...c, slots: JSON.parse(c.slots) })),
    }));

    const cleanSizes = (sizes) => {
      if (!Array.isArray(sizes) || sizes.length > 5) return null;
      const out = [];
      for (const s of sizes) {
        if (!s || typeof s.label !== 'string' || !s.label.trim() || !Number.isInteger(s.extra_cents) || s.extra_cents < 0) return null;
        out.push({ label: s.label.trim().slice(0, 30), extra_cents: s.extra_cents });
      }
      return out;
    };
    const csv = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean).join(',');

    admin.post('/menu', async (req, reply) => {
      const b = req.body ?? {};
      const price = Number(b.priceCents);
      const kind = b.kind ?? 'autre';
      if (!b.name || !b.category || !Number.isInteger(price) || price < 0 || !KINDS.includes(kind))
        return reply.code(400).send({ error: 'Article invalide' });
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO menu_items (category, name, description, price_cents, kind, position)
           VALUES (?,?,?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM menu_items))`,
        )
        .run(String(b.category), String(b.name), String(b.description ?? ''), price, kind);
      return reply.code(201).send({ id: Number(lastInsertRowid) });
    });

    admin.patch('/menu/:id', async (req, reply) => {
      const b = req.body ?? {};
      const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
      if (!item) return reply.code(404).send({ error: 'Article introuvable' });
      const price = b.priceCents === undefined ? item.price_cents : Number(b.priceCents);
      if (!Number.isInteger(price) || price < 0) return reply.code(400).send({ error: 'Prix invalide' });
      const kind = b.kind ?? item.kind;
      if (!KINDS.includes(kind)) return reply.code(400).send({ error: 'Type invalide' });
      let sizes = item.sizes;
      if (b.sizes !== undefined) {
        const clean = cleanSizes(b.sizes);
        if (!clean) return reply.code(400).send({ error: 'Tailles invalides' });
        sizes = JSON.stringify(clean);
      }
      if (b.soldOutToday !== undefined) db.prepare('UPDATE menu_items SET sold_out_date = ? WHERE id = ?').run(b.soldOutToday ? todayDate() : null, item.id);
      db.prepare(
        `UPDATE menu_items SET category=?, name=?, description=?, price_cents=?, kind=?, vegetarian=?,
           allergens=?, ingredients=?, sizes=?, available=? WHERE id=?`,
      ).run(
        b.category ?? item.category, b.name ?? item.name, b.description ?? item.description, price, kind,
        b.vegetarian === undefined ? item.vegetarian : b.vegetarian ? 1 : 0,
        b.allergens === undefined ? item.allergens : csv(b.allergens),
        b.ingredients === undefined ? item.ingredients : csv(b.ingredients),
        sizes, b.available === undefined ? item.available : b.available ? 1 : 0, item.id,
      );
      return { ok: true };
    });

    // Photo : l'admin redimensionne en JPEG dans le navigateur puis l'envoie en base64.
    admin.put('/menu/:id/image', { bodyLimit: 1_500_000 }, async (req, reply) => {
      const item = db.prepare('SELECT id FROM menu_items WHERE id = ?').get(req.params.id);
      if (!item) return reply.code(404).send({ error: 'Article introuvable' });
      if (req.body?.dataUrl === null) {
        db.prepare('UPDATE menu_items SET image_url = NULL WHERE id = ?').run(item.id);
        return { ok: true };
      }
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.dataUrl ?? ''));
      const buf = m ? Buffer.from(m[1], 'base64') : null;
      if (!buf || buf.length > 900_000 || buf[0] !== 0xff || buf[1] !== 0xd8)
        return reply.code(400).send({ error: 'Image JPEG invalide ou trop lourde' });
      writeFileSync(join(uploadsDir, `item-${item.id}.jpg`), buf);
      const url = `/uploads/item-${item.id}.jpg?v=${Date.now()}`;
      db.prepare('UPDATE menu_items SET image_url = ? WHERE id = ?').run(url, item.id);
      return { image_url: url };
    });

    admin.post('/supplements', async (req, reply) => {
      const price = Number(req.body?.priceCents);
      if (!req.body?.name || !Number.isInteger(price) || price < 0) return reply.code(400).send({ error: 'Supplément invalide' });
      const { lastInsertRowid } = db.prepare('INSERT INTO supplements (name, price_cents) VALUES (?,?)').run(String(req.body.name), price);
      return reply.code(201).send({ id: Number(lastInsertRowid) });
    });
    admin.patch('/supplements/:id', async (req, reply) => {
      const b = req.body ?? {};
      const s = db.prepare('SELECT * FROM supplements WHERE id = ?').get(req.params.id);
      if (!s) return reply.code(404).send({ error: 'Supplément introuvable' });
      const price = b.priceCents === undefined ? s.price_cents : Number(b.priceCents);
      if (!Number.isInteger(price) || price < 0) return reply.code(400).send({ error: 'Prix invalide' });
      if (b.soldOutToday !== undefined) db.prepare('UPDATE supplements SET sold_out_date = ? WHERE id = ?').run(b.soldOutToday ? todayDate() : null, s.id);
      db.prepare('UPDATE supplements SET name=?, price_cents=?, available=? WHERE id=?').run(
        b.name ?? s.name, price, b.available === undefined ? s.available : b.available ? 1 : 0, s.id,
      );
      return { ok: true };
    });

    const validSlots = (slots) => Array.isArray(slots) && slots.length >= 1 && slots.length <= 5 && slots.every((k) => KINDS.includes(k));
    admin.post('/combos', async (req, reply) => {
      const b = req.body ?? {};
      const price = Number(b.priceCents);
      if (!b.name || !Number.isInteger(price) || price < 0 || !validSlots(b.slots)) return reply.code(400).send({ error: 'Formule invalide' });
      const { lastInsertRowid } = db
        .prepare('INSERT INTO combos (name, description, price_cents, slots) VALUES (?,?,?,?)')
        .run(String(b.name), String(b.description ?? ''), price, JSON.stringify(b.slots));
      return reply.code(201).send({ id: Number(lastInsertRowid) });
    });
    admin.patch('/combos/:id', async (req, reply) => {
      const b = req.body ?? {};
      const c = db.prepare('SELECT * FROM combos WHERE id = ?').get(req.params.id);
      if (!c) return reply.code(404).send({ error: 'Formule introuvable' });
      const price = b.priceCents === undefined ? c.price_cents : Number(b.priceCents);
      if (!Number.isInteger(price) || price < 0) return reply.code(400).send({ error: 'Prix invalide' });
      if (b.slots !== undefined && !validSlots(b.slots)) return reply.code(400).send({ error: 'Composition invalide' });
      db.prepare('UPDATE combos SET name=?, description=?, price_cents=?, slots=?, available=? WHERE id=?').run(
        b.name ?? c.name, b.description ?? c.description, price,
        b.slots === undefined ? c.slots : JSON.stringify(b.slots),
        b.available === undefined ? c.available : b.available ? 1 : 0, c.id,
      );
      return { ok: true };
    });
  }, { prefix: '/api/admin' });

  app.get('/admin', (req, reply) => reply.sendFile('admin.html'));
  // La version web de la commande (voir mobile/README : npm run build:web) est servie sur /commande/.
  app.get('/', (req, reply) => reply.redirect('/commande/'));
  return app;
}
