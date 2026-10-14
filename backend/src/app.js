import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { availableSlots, localNow } from './time.js';
import { sendPush } from './push.js';
import { OrderError, priceLine, shapeItem } from './pricing.js';
import { readSettings, writeSettings } from './settings.js';
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

export async function buildApp({ db, config, stripe, fetchImpl = fetch, now = () => new Date(), logger = false }) {
  const app = Fastify({ logger });
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

  const slotsFor = (pizzas = 1) => {
    const settings = readSettings(db);
    const date = localNow(config.timezone, now()).date;
    if (!settings.ordersOpen) return { date, slots: [], maxPizzasPerSlot: settings.maxPizzasPerSlot };
    const result = availableSlots(config, now(), {
      extraLeadMinutes: settings.rushMinutes,
      maxPerSlot: settings.maxPizzasPerSlot,
      booked: bookedByTime(date),
      pizzas,
    });
    return { ...result, maxPizzasPerSlot: settings.maxPizzasPerSlot };
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
    };
  });

  app.get('/api/menu', async () => {
    const items = db.prepare('SELECT * FROM menu_items WHERE available = 1 ORDER BY position, id').all().map(shapeItem);
    const supplements = db.prepare('SELECT id, name, price_cents FROM supplements WHERE available = 1 ORDER BY id').all();
    const combos = db
      .prepare('SELECT id, name, description, price_cents, slots FROM combos WHERE available = 1 ORDER BY id')
      .all()
      .map((c) => ({ ...c, slots: JSON.parse(c.slots) }));
    const settings = readSettings(db);
    return { items, supplements, combos, banner: settings.banner, halfAndHalf: settings.halfAndHalf };
  });

  app.get('/api/slots', async (req) => {
    expireStale();
    return slotsFor(Number(req.query.pizzas) || 1);
  });

  app.get('/api/loyalty/:id', async (req, reply) => {
    if (!isValidLoyaltyId(req.params.id)) return reply.code(400).send({ error: 'Identifiant invalide' });
    expireStale();
    return loyaltyStatus(db, req.params.id);
  });

  app.post(
    '/api/orders',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const b = req.body ?? {};
      const name = String(b.customerName ?? '').trim();
      const phone = String(b.phone ?? '').replace(/[\s.-]/g, '');
      const note = String(b.note ?? '').trim().slice(0, 300);
      if (name.length < 2 || name.length > 60) return reply.code(400).send({ error: 'Nom invalide' });
      if (!/^\+?\d{10,14}$/.test(phone)) return reply.code(400).send({ error: 'Téléphone invalide' });
      if (!['online', 'on_pickup'].includes(b.paymentMethod))
        return reply.code(400).send({ error: 'Mode de paiement invalide' });
      if (b.paymentMethod === 'online' && !onlinePayment)
        return reply.code(400).send({ error: 'Paiement en ligne indisponible' });
      if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 50)
        return reply.code(400).send({ error: 'Panier vide' });
      if (b.loyaltyId != null && !isValidLoyaltyId(b.loyaltyId))
        return reply.code(400).send({ error: 'Identifiant de fidélité invalide' });
      if (b.useReward && !b.loyaltyId) return reply.code(400).send({ error: 'Carte de fidélité requise' });
      if (!readSettings(db).ordersOpen)
        return reply.code(423).send({ error: 'Les commandes sont momentanément fermées' });

      expireStale();
      const lines = b.items.map((l) => priceLine(db, l));
      const pizzaCount = lines.reduce((n, l) => n + l.pizzas, 0);
      const subtotal = lines.reduce((s, l) => s + l.unitCents * l.quantity, 0);

      // Pizza offerte : la moins chère des pizzas (hors formules), une seule par commande.
      let discount = 0;
      if (b.useReward) {
        const eligible = lines.filter((l) => l.rewardEligible);
        if (!eligible.length) return reply.code(400).send({ error: 'Ajoutez une pizza pour utiliser votre récompense' });
        discount = Math.min(...eligible.map((l) => l.unitCents));
      }
      const total = subtotal - discount;

      const id = randomUUID();
      const online = b.paymentMethod === 'online';
      const pushToken = typeof b.pushToken === 'string' ? b.pushToken.slice(0, 200) : null;
      const createdAt = now().toISOString();

      transaction(db, () => {
        const { date, slots } = slotsFor(pizzaCount);
        if (!slots.includes(b.pickupTime)) {
          const full = pizzaCount > 0 && availableSlots(config, now(), { extraLeadMinutes: readSettings(db).rushMinutes }).slots.includes(b.pickupTime);
          throw new OrderError(full ? "Ce créneau est complet, choisissez une autre heure" : 'Créneau indisponible, choisissez une autre heure');
        }
        if (b.useReward) {
          if (loyaltyStatus(db, b.loyaltyId).rewardsAvailable < 1) throw new OrderError("Aucune pizza offerte disponible");
          consumeReward(db, b.loyaltyId);
        }
        const { n } = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE pickup_date = ?').get(date);
        db.prepare(
          `INSERT INTO orders (id, number, customer_name, phone, note, pickup_date, pickup_time,
             payment_method, payment_status, status, total_cents, discount_cents, pizza_count,
             loyalty_id, reward_used, push_token, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          id, n + 1, name, phone, note, date, b.pickupTime, b.paymentMethod,
          online ? 'pending' : 'unpaid', online ? 'pending_payment' : 'new',
          total, discount, pizzaCount, b.loyaltyId ?? null, b.useReward ? 1 : 0, pushToken, createdAt,
        );
        const insertLine = db.prepare(
          'INSERT INTO order_items (order_id, name, details, quantity, unit_price_cents, config) VALUES (?,?,?,?,?,?)',
        );
        for (const l of lines) insertLine.run(id, l.name, l.details, l.quantity, l.unitCents, JSON.stringify(l.config));
      });

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
      return reply.code(201).send({ order: publicOrder(loadOrder(db, id)), clientSecret });
    },
  );

  // L'identifiant est un UUID aléatoire : il sert de "lien secret" de suivi.
  app.get('/api/orders/:id', async (req, reply) => {
    const order = loadOrder(db, req.params.id);
    if (!order) return reply.code(404).send({ error: 'Commande introuvable' });
    return { order: publicOrder(order) };
  });

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
      const today = localNow(config.timezone, now()).date;
      const rows = db
        .prepare(
          `SELECT id FROM orders
           WHERE status != 'pending_payment'
             AND (pickup_date = ? OR status IN ('new','preparing','ready'))
           ORDER BY pickup_date, pickup_time, number`,
        )
        .all(today);
      return { orders: rows.map((r) => publicOrder(loadOrder(db, r.id))) };
    });

    admin.patch('/orders/:id/status', async (req, reply) => {
      const { status } = req.body ?? {};
      if (!STATUSES.includes(status)) return reply.code(400).send({ error: 'Statut invalide' });
      const order = loadOrder(db, req.params.id);
      if (!order || order.status === 'pending_payment') return reply.code(404).send({ error: 'Commande introuvable' });
      if (order.status === 'cancelled') return reply.code(409).send({ error: 'Commande déjà annulée' });

      transaction(db, () => {
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
        if (status === 'cancelled' && order.reward_used && order.loyalty_id) {
          refundReward(db, order.loyalty_id);
          db.prepare('UPDATE orders SET reward_used = 0 WHERE id = ?').run(order.id);
        }
        // Les tampons sont crédités au retrait de la commande, une seule fois.
        if (status === 'done' && order.loyalty_id && !order.stamps_credited) {
          addStamps(db, order.loyalty_id, order.pizza_count - (order.reward_used ? 1 : 0));
          db.prepare('UPDATE orders SET stamps_credited = 1 WHERE id = ?').run(order.id);
        }
      });
      if (status === 'ready')
        sendPush(order.push_token, 'Votre commande est prête 🍕', `Commande n°${order.number} à retirer chez Little Italy.`, fetchImpl);
      return { order: publicOrder(loadOrder(db, order.id)) };
    });

    admin.get('/settings', async () => readSettings(db));
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
  return app;
}
