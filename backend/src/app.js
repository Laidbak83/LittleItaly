import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { availableSlots, localNow } from './time.js';
import { sendPush } from './push.js';

const STATUSES = ['new', 'preparing', 'ready', 'done', 'cancelled'];
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
    .prepare('SELECT name, quantity, unit_price_cents FROM order_items WHERE order_id = ?')
    .all(id);
  return order;
}

// Ne jamais exposer le jeton push ni l'identifiant Stripe au client.
const publicOrder = ({ push_token, stripe_payment_intent, ...rest }) => rest;

export async function buildApp({ db, config, stripe, fetchImpl = fetch, now = () => new Date(), logger = false }) {
  const app = Fastify({ logger });
  const stripeClient = stripe ?? (config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null);

  await app.register(cors, { origin: true });
  await app.register(rateLimit, { global: false });
  await app.register(fastifyStatic, { root: publicDir });

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

  // ---------- Public ----------
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/config', async () => ({
    onlinePaymentEnabled: Boolean(stripeClient && config.stripePublishableKey),
    stripePublishableKey: config.stripePublishableKey || null,
  }));

  app.get('/api/menu', async () => {
    const items = db
      .prepare('SELECT id, category, name, description, price_cents FROM menu_items WHERE available = 1 ORDER BY position, id')
      .all();
    return { items };
  });

  app.get('/api/slots', async () => availableSlots(config, now()));

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
      if (b.paymentMethod === 'online' && !(stripeClient && config.stripePublishableKey))
        return reply.code(400).send({ error: 'Paiement en ligne indisponible' });
      if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 50)
        return reply.code(400).send({ error: 'Panier vide' });

      const { date, slots } = availableSlots(config, now());
      if (!slots.includes(b.pickupTime))
        return reply.code(400).send({ error: "Créneau indisponible, choisissez une autre heure" });

      // Les prix viennent TOUJOURS de la base, jamais du client.
      const lookup = db.prepare('SELECT id, name, price_cents FROM menu_items WHERE id = ? AND available = 1');
      const lines = [];
      for (const it of b.items) {
        const qty = Number(it.quantity);
        if (!Number.isInteger(qty) || qty < 1 || qty > config.maxItemQty)
          return reply.code(400).send({ error: 'Quantité invalide' });
        const row = lookup.get(Number(it.itemId));
        if (!row) return reply.code(400).send({ error: 'Article indisponible' });
        lines.push({ name: row.name, quantity: qty, price: row.price_cents });
      }
      const total = lines.reduce((s, l) => s + l.price * l.quantity, 0);

      const id = randomUUID();
      const online = b.paymentMethod === 'online';
      const pushToken = typeof b.pushToken === 'string' ? b.pushToken.slice(0, 200) : null;

      db.exec('BEGIN IMMEDIATE');
      try {
        const { n } = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE pickup_date = ?').get(date);
        db.prepare(
          `INSERT INTO orders (id, number, customer_name, phone, note, pickup_date, pickup_time,
             payment_method, payment_status, status, total_cents, push_token)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          id, n + 1, name, phone, note, date, b.pickupTime, b.paymentMethod,
          online ? 'pending' : 'unpaid', online ? 'pending_payment' : 'new', total, pushToken,
        );
        const insertLine = db.prepare(
          'INSERT INTO order_items (order_id, name, quantity, unit_price_cents) VALUES (?,?,?,?)',
        );
        for (const l of lines) insertLine.run(id, l.name, l.quantity, l.price);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      let clientSecret = null;
      if (online) {
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
          db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(id);
          req.log.error(err);
          return reply.code(502).send({ error: 'Le paiement en ligne a échoué, réessayez' });
        }
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
      const orderId = event.data.object.metadata?.orderId;
      db.prepare(
        `UPDATE orders SET payment_status = 'paid', status = 'new'
         WHERE id = ? AND status = 'pending_payment'`,
      ).run(orderId);
    }
    return { received: true };
  });

  // ---------- Admin (Olivier) ----------
  app.register(async (admin) => {
    admin.addHook('preHandler', requireAdmin);

    admin.get('/orders', async () => {
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
      if (!order || order.status === 'pending_payment')
        return reply.code(404).send({ error: 'Commande introuvable' });
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
      if (status === 'ready')
        sendPush(order.push_token, 'Votre commande est prête 🍕', `Commande n°${order.number} à retirer chez Little Italy.`, fetchImpl);
      return { order: publicOrder(loadOrder(db, order.id)) };
    });

    admin.get('/menu', async () => ({
      items: db.prepare('SELECT * FROM menu_items ORDER BY position, id').all(),
    }));

    admin.post('/menu', async (req, reply) => {
      const b = req.body ?? {};
      const price = Number(b.priceCents);
      if (!b.name || !b.category || !Number.isInteger(price) || price < 0)
        return reply.code(400).send({ error: 'Article invalide' });
      const { lastInsertRowid } = db
        .prepare('INSERT INTO menu_items (category, name, description, price_cents, position) VALUES (?,?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM menu_items))')
        .run(String(b.category), String(b.name), String(b.description ?? ''), price);
      return reply.code(201).send({ id: Number(lastInsertRowid) });
    });

    admin.patch('/menu/:id', async (req, reply) => {
      const b = req.body ?? {};
      const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
      if (!item) return reply.code(404).send({ error: 'Article introuvable' });
      const price = b.priceCents === undefined ? item.price_cents : Number(b.priceCents);
      if (!Number.isInteger(price) || price < 0) return reply.code(400).send({ error: 'Prix invalide' });
      db.prepare('UPDATE menu_items SET category=?, name=?, description=?, price_cents=?, available=? WHERE id=?').run(
        b.category ?? item.category, b.name ?? item.name, b.description ?? item.description,
        price, b.available === undefined ? item.available : b.available ? 1 : 0, item.id,
      );
      return { ok: true };
    });
  }, { prefix: '/api/admin' });

  app.get('/admin', (req, reply) => reply.sendFile('admin.html'));
  return app;
}
