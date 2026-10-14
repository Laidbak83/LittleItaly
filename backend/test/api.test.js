import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { availableSlots } from '../src/time.js';

// 2026-10-14 12:00 à Paris (UTC+2) = 10:00 UTC
const NOW = new Date('2026-10-14T10:00:00Z');
const config = { ...loadConfig({ ADMIN_TOKEN: 'secret', STRIPE_PUBLISHABLE_KEY: 'pk_test_x' }), dbPath: ':memory:' };

async function setup(opts = {}) {
  const pushes = [];
  const app = await buildApp({
    db: openDb(':memory:'),
    config,
    now: () => NOW,
    fetchImpl: async (url, init) => pushes.push(JSON.parse(init.body)),
    ...opts,
  });
  return { app, pushes };
}
const order = (over = {}) => ({
  customerName: 'Marie', phone: '06 12 34 56 78', pickupTime: '18:00',
  paymentMethod: 'on_pickup', items: [{ itemId: 1, quantity: 2 }], ...over,
});
const admin = { authorization: 'Bearer secret' };

test('créneaux : respectent le délai de préparation et les plages', () => {
  const { slots } = availableSlots(config, NOW); // il est 12:00 → premier créneau 12:30 puis 18:00
  assert.equal(slots[0], '12:30');
  assert.ok(slots.includes('18:00') && slots.includes('22:00'));
  assert.ok(!slots.includes('15:00'));
});

test('commande au retrait : prix calculé côté serveur', async () => {
  const { app } = await setup();
  const res = await app.inject({ method: 'POST', url: '/api/orders', payload: order({ items: [{ itemId: 1, quantity: 2, price: 1 }] }) });
  assert.equal(res.statusCode, 201);
  const { order: o } = res.json();
  assert.equal(o.total_cents, 1800); // 2 × Margherita 9,00 €
  assert.equal(o.status, 'new');
  assert.equal(o.payment_status, 'unpaid');
  assert.equal(o.push_token, undefined);
});

test('refuse créneau passé, panier vide, téléphone invalide, article inconnu', async () => {
  const { app } = await setup();
  const bad = async (over) =>
    (await app.inject({ method: 'POST', url: '/api/orders', payload: order(over) })).statusCode;
  assert.equal(await bad({ pickupTime: '11:00' }), 400);
  assert.equal(await bad({ items: [] }), 400);
  assert.equal(await bad({ phone: '123' }), 400);
  assert.equal(await bad({ items: [{ itemId: 999, quantity: 1 }] }), 400);
  assert.equal(await bad({ items: [{ itemId: 1, quantity: 0 }] }), 400);
});

test('paiement en ligne refusé si Stripe non configuré', async () => {
  const { app } = await setup();
  const res = await app.inject({ method: 'POST', url: '/api/orders', payload: order({ paymentMethod: 'online' }) });
  assert.equal(res.statusCode, 400);
});

test('paiement en ligne : commande masquée tant que non payée, visible après webhook', async () => {
  const stripe = {
    paymentIntents: { create: async () => ({ id: 'pi_1', client_secret: 'cs_1' }) },
    webhooks: {
      constructEvent: (raw) => JSON.parse(raw),
    },
  };
  const { app } = await setup({ stripe, config: { ...config, stripeWebhookSecret: 'whsec' } });
  const res = await app.inject({ method: 'POST', url: '/api/orders', payload: order({ paymentMethod: 'online' }) });
  assert.equal(res.statusCode, 201);
  const { order: o, clientSecret } = res.json();
  assert.equal(clientSecret, 'cs_1');
  assert.equal(o.status, 'pending_payment');

  let list = (await app.inject({ url: '/api/admin/orders', headers: admin })).json().orders;
  assert.equal(list.length, 0);

  const hook = await app.inject({
    method: 'POST', url: '/api/stripe/webhook', headers: { 'stripe-signature': 'x', 'content-type': 'application/json' },
    payload: JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { metadata: { orderId: o.id } } } }),
  });
  assert.equal(hook.statusCode, 200);
  list = (await app.inject({ url: '/api/admin/orders', headers: admin })).json().orders;
  assert.equal(list.length, 1);
  assert.equal(list[0].payment_status, 'paid');
});

test('admin : authentification obligatoire', async () => {
  const { app } = await setup();
  assert.equal((await app.inject({ url: '/api/admin/orders' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/admin/orders', headers: { authorization: 'Bearer nope' } })).statusCode, 401);
  const { app: noToken } = await setup({ config: { ...config, adminToken: '' } });
  assert.equal((await noToken.inject({ url: '/api/admin/orders', headers: admin })).statusCode, 503);
});

test('admin : statut "prêt" envoie une notification push', async () => {
  const { app, pushes } = await setup();
  const { order: o } = (await app.inject({
    method: 'POST', url: '/api/orders',
    payload: order({ pushToken: 'ExponentPushToken[abc]' }),
  })).json();
  const res = await app.inject({ method: 'PATCH', url: `/api/admin/orders/${o.id}/status`, headers: admin, payload: { status: 'ready' } });
  assert.equal(res.statusCode, 200);
  await new Promise((r) => setImmediate(r));
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].to, 'ExponentPushToken[abc]');
  const bad = await app.inject({ method: 'PATCH', url: `/api/admin/orders/${o.id}/status`, headers: admin, payload: { status: 'nope' } });
  assert.equal(bad.statusCode, 400);
});

test('admin : un article désactivé disparaît du menu public', async () => {
  const { app } = await setup();
  await app.inject({ method: 'PATCH', url: '/api/admin/menu/1', headers: admin, payload: { available: false } });
  const items = (await app.inject({ url: '/api/menu' })).json().items;
  assert.ok(!items.some((i) => i.id === 1));
  const res = await app.inject({ method: 'POST', url: '/api/orders', payload: order() });
  assert.equal(res.statusCode, 400);
});
