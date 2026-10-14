import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';

const config = { ...loadConfig({ ADMIN_TOKEN: 'secret', STRIPE_PUBLISHABLE_KEY: 'pk_test_x' }), dbPath: ':memory:' };
const admin = { authorization: 'Bearer secret' };
const LOYALTY = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

async function setup(opts = {}) {
  let t = new Date('2026-10-14T10:00:00Z'); // 12:00 à Paris
  const clock = { advance: (ms) => (t = new Date(t.getTime() + ms)) };
  const app = await buildApp({ db: openDb(':memory:'), config, now: () => t, fetchImpl: async () => {}, ...opts });
  // Capacité illimitée par défaut (le test dédié fixe sa propre limite).
  await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: admin, payload: { maxPizzasPerSlot: 0 } });
  return { app, clock };
}
const base = (over = {}) => ({
  customerName: 'Marie', phone: '0612345678', pickupTime: '18:00', paymentMethod: 'on_pickup',
  items: [{ itemId: 1, quantity: 1 }], ...over,
});
const post = (app, payload) => app.inject({ method: 'POST', url: '/api/orders', payload });
const total = async (app, items, extra = {}) => {
  const res = await post(app, base({ items, ...extra }));
  assert.equal(res.statusCode, 201, res.body);
  return res.json().order;
};
const setStatus = (app, id, status) =>
  app.inject({ method: 'PATCH', url: `/api/admin/orders/${id}/status`, headers: admin, payload: { status } });

test('menu public : formules, suppléments, tailles, allergènes', async () => {
  const { app } = await setup();
  const m = (await app.inject({ url: '/api/menu' })).json();
  assert.equal(m.items[0].sizes.length, 2);
  assert.deepEqual(m.items[0].allergens, ['gluten', 'lait']);
  assert.equal(m.items[0].vegetarian, true);
  assert.equal(m.combos.length, 2);
  assert.ok(m.supplements.length > 0);
});

test('personnalisation : taille + suppléments + sans ingrédient', async () => {
  const { app } = await setup();
  // Reine (id 2) 11,00 + Grande 4,00 + Œuf (1) 1,00 + Chèvre (2) 1,50 = 17,50
  const o = await total(app, [{ itemId: 2, quantity: 2, sizeIndex: 1, extras: [1, 2], removed: ['Champignons'] }]);
  assert.equal(o.total_cents, 3500);
  assert.equal(o.items[0].details, 'Grande · + Œuf, Chèvre · sans Champignons');
  assert.equal(o.pizza_count, 2);
});

test('moitié-moitié : prix de la plus chère', async () => {
  const { app } = await setup();
  const o = await total(app, [{ itemId: 1, quantity: 1, halfItemId: 5 }]); // Margherita 9 / 4 fromages 13
  assert.equal(o.total_cents, 1300);
  assert.match(o.items[0].name, /Margherita.*4 fromages/);
});

test('personnalisation : options invalides refusées', async () => {
  const { app } = await setup();
  const bad = async (line) => (await post(app, base({ items: [line] }))).statusCode;
  assert.equal(await bad({ itemId: 1, quantity: 1, sizeIndex: 5 }), 400);
  assert.equal(await bad({ itemId: 1, quantity: 1, removed: ['Ananas'] }), 400);
  assert.equal(await bad({ itemId: 1, quantity: 1, extras: [999] }), 400);
  assert.equal(await bad({ itemId: 1, quantity: 1, extras: [1, 1] }), 400);
  assert.equal(await bad({ itemId: 1, quantity: 1, halfItemId: 1 }), 400);
  assert.equal(await bad({ itemId: 7, quantity: 1, extras: [1] }), 400); // pas de supplément sur une boisson
  assert.equal(await bad({ itemId: 1, quantity: 1, price: 1, extras: 'x' }), 400);
});

test('formules : composition validée, prix fixe', async () => {
  const { app } = await setup();
  const o = await total(app, [{ comboId: 1, quantity: 1, picks: [5, 7] }]); // 4 fromages + Coca
  assert.equal(o.total_cents, 1100);
  assert.equal(o.items[0].details, '4 fromages + Coca-Cola 33cl');
  assert.equal(o.pizza_count, 1);
  assert.equal((await post(app, base({ items: [{ comboId: 1, quantity: 1, picks: [7, 5] }] }))).statusCode, 400); // mauvais ordre
  assert.equal((await post(app, base({ items: [{ comboId: 1, quantity: 1, picks: [5] }] }))).statusCode, 400);
});

test('fidélité : tampons au retrait, 10 tampons = pizza offerte, annulation rembourse', async () => {
  const { app } = await setup();
  // 10 pizzas retirées
  const o1 = await total(app, [{ itemId: 1, quantity: 10 }], { loyaltyId: LOYALTY });
  assert.equal((await app.inject({ url: `/api/loyalty/${LOYALTY}` })).json().progress, 0);
  await setStatus(app, o1.id, 'done');
  await setStatus(app, o1.id, 'done'); // idempotent
  let l = (await app.inject({ url: `/api/loyalty/${LOYALTY}` })).json();
  assert.equal(l.rewardsAvailable, 1);
  assert.equal(l.progress, 0);

  // utilisation : la moins chère des pizzas est offerte
  const o2 = await total(app, [{ itemId: 2, quantity: 1 }, { itemId: 1, quantity: 1 }], { loyaltyId: LOYALTY, useReward: true });
  assert.equal(o2.discount_cents, 900);
  assert.equal(o2.total_cents, 1100);
  l = (await app.inject({ url: `/api/loyalty/${LOYALTY}` })).json();
  assert.equal(l.rewardsAvailable, 0);
  assert.equal((await post(app, base({ loyaltyId: LOYALTY, useReward: true }))).statusCode, 400); // plus de récompense

  // annulation : la récompense est rendue
  await setStatus(app, o2.id, 'cancelled');
  assert.equal((await app.inject({ url: `/api/loyalty/${LOYALTY}` })).json().rewardsAvailable, 1);
  assert.equal((await setStatus(app, o2.id, 'new')).statusCode, 409);

  // la pizza offerte ne donne pas de tampon
  const o3 = await total(app, [{ itemId: 1, quantity: 2 }], { loyaltyId: LOYALTY, useReward: true });
  await setStatus(app, o3.id, 'done');
  assert.equal((await app.inject({ url: `/api/loyalty/${LOYALTY}` })).json().progress, 1);
});

test('fidélité : récompense impossible sans pizza ou sans identifiant valide', async () => {
  const { app } = await setup();
  assert.equal((await post(app, base({ useReward: true }))).statusCode, 400);
  assert.equal((await post(app, base({ loyaltyId: 'court', useReward: true }))).statusCode, 400);
  assert.equal((await app.inject({ url: '/api/loyalty/court' })).statusCode, 400);
});

test('capacité du four : créneau complet refusé', async () => {
  const { app } = await setup();
  await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: admin, payload: { maxPizzasPerSlot: 3 } });
  await total(app, [{ itemId: 1, quantity: 2 }]);
  let slots = (await app.inject({ url: '/api/slots?pizzas=2' })).json().slots;
  assert.ok(!slots.includes('18:00'));
  slots = (await app.inject({ url: '/api/slots?pizzas=1' })).json().slots;
  assert.ok(slots.includes('18:00'));
  const res = await post(app, base({ items: [{ itemId: 1, quantity: 2 }] }));
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /complet/);
  assert.equal((await post(app, base({ items: [{ itemId: 7, quantity: 5 }] }))).statusCode, 201); // boissons : pas de limite
});

test('mode rush et fermeture des commandes', async () => {
  const { app } = await setup();
  const first = async () => (await app.inject({ url: '/api/slots' })).json().slots[0];
  assert.equal(await first(), '12:30');
  await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: admin, payload: { rushMinutes: 30 } });
  assert.equal(await first(), '13:00');
  await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: admin, payload: { ordersOpen: false, banner: 'Fermé ce soir' } });
  assert.equal((await app.inject({ url: '/api/slots' })).json().slots.length, 0);
  assert.equal((await post(app, base())).statusCode, 423);
  assert.equal((await app.inject({ url: '/api/config' })).json().ordersOpen, false);
  assert.equal((await app.inject({ url: '/api/menu' })).json().banner, 'Fermé ce soir');
  const bad = await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: admin, payload: { rushMinutes: 500 } });
  assert.equal(bad.statusCode, 400);
});

test('commande en ligne abandonnée : annulée après 30 min, récompense rendue, paiement bloqué', async () => {
  const cancelled = [];
  const stripe = {
    paymentIntents: { create: async () => ({ id: 'pi_9', client_secret: 'cs' }), cancel: async (id) => cancelled.push(id) },
    webhooks: { constructEvent: (raw) => JSON.parse(raw) },
    refunds: { create: async () => ({}) },
  };
  const { app, clock } = await setup({ stripe, config: { ...config, stripeWebhookSecret: 'w' } });
  const seed = await total(app, [{ itemId: 1, quantity: 10 }], { loyaltyId: LOYALTY });
  await setStatus(app, seed.id, 'done');

  const o = await total(app, [{ itemId: 1, quantity: 1 }, { itemId: 7, quantity: 1 }], { loyaltyId: LOYALTY, useReward: true, paymentMethod: 'online' });
  assert.equal(o.status, 'pending_payment');
  assert.equal((await app.inject({ url: `/api/loyalty/${LOYALTY}` })).json().rewardsAvailable, 0);

  clock.advance(31 * 60 * 1000);
  assert.equal((await app.inject({ url: `/api/loyalty/${LOYALTY}` })).json().rewardsAvailable, 1);
  assert.equal((await app.inject({ url: `/api/orders/${o.id}` })).json().order.status, 'cancelled');
  assert.deepEqual(cancelled, ['pi_9']);
});

test('pizza offerte seule en ligne : rien à payer, commande validée directement', async () => {
  const stripe = { paymentIntents: { create: async () => assert.fail('pas de paiement') }, webhooks: {} };
  const { app } = await setup({ stripe });
  const seed = await total(app, [{ itemId: 1, quantity: 10 }], { loyaltyId: LOYALTY });
  await setStatus(app, seed.id, 'done');
  const res = await post(app, base({ loyaltyId: LOYALTY, useReward: true, paymentMethod: 'online' }));
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().order.total_cents, 0);
  assert.equal(res.json().order.status, 'new');
});

test('photo : upload JPEG valide, refus du reste', async () => {
  const { app } = await setup();
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]).toString('base64');
  const ok = await app.inject({ method: 'PUT', url: '/api/admin/menu/1/image', headers: admin, payload: { dataUrl: `data:image/jpeg;base64,${jpeg}` } });
  assert.equal(ok.statusCode, 200);
  const url = ok.json().image_url;
  assert.equal((await app.inject({ url })).statusCode, 200);
  const png = Buffer.from([0x89, 0x50]).toString('base64');
  assert.equal((await app.inject({ method: 'PUT', url: '/api/admin/menu/1/image', headers: admin, payload: { dataUrl: `data:image/jpeg;base64,${png}` } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PUT', url: '/api/admin/menu/1/image', payload: { dataUrl: null } })).statusCode, 401);
});

test('admin : édition article (type, allergènes, tailles) + suppléments + formules', async () => {
  const { app } = await setup();
  const patch = (url, payload) => app.inject({ method: 'PATCH', url: `/api/admin${url}`, headers: admin, payload });
  assert.equal((await patch('/menu/7', { kind: 'boisson', allergens: 'sulfites, ', vegetarian: true })).statusCode, 200);
  assert.equal((await patch('/menu/1', { sizes: [{ label: 'Géante', extra_cents: 700 }] })).statusCode, 200);
  assert.equal((await patch('/menu/1', { sizes: [{ label: '', extra_cents: 1 }] })).statusCode, 400);
  const o = await total(app, [{ itemId: 1, quantity: 1, sizeIndex: 0 }]);
  assert.equal(o.total_cents, 1600);
  assert.equal((await patch('/supplements/1', { priceCents: 200 })).statusCode, 200);
  const created = await app.inject({ method: 'POST', url: '/api/admin/combos', headers: admin, payload: { name: 'Solo', priceCents: 1000, slots: ['pizza', 'dessert'] } });
  assert.equal(created.statusCode, 201);
  assert.equal((await app.inject({ method: 'POST', url: '/api/admin/combos', headers: admin, payload: { name: 'X', priceCents: 1, slots: ['pizza'] } })).statusCode, 400);
});
