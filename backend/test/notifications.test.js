import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { localToDate } from '../src/time.js';
import { seedFixture } from './fixture.js';

const config = loadConfig({ ADMIN_TOKEN: 'secret' });
for (const d of Object.keys(config.hoursByWeekday)) config.hoursByWeekday[d] = [['00:00', '23:45']]; // ouvert 24 h pour les tests
config.dbPath = ':memory:';
const admin = { authorization: 'Bearer secret' };
const TOKEN = 'ExponentPushToken[abc]';
const SUB = { endpoint: 'https://push.example.test/abc', keys: { p256dh: 'p256dh-key', auth: 'auth-key' } };

async function setup() {
  let t = new Date('2026-10-14T10:00:00Z'); // 12:00 à Paris
  const clock = { advance: (min) => (t = new Date(t.getTime() + min * 60000)), at: (iso) => (t = new Date(iso)) };
  const expo = [];
  const web = { calls: [], fail: null };
  const webPush = {
    generateVAPIDKeys: () => ({ publicKey: 'PUBLIC-KEY', privateKey: 'PRIVATE-KEY' }),
    sendNotification: async (sub, payload, opts) => {
      if (web.fail) throw Object.assign(new Error('gone'), { statusCode: web.fail });
      web.calls.push({ sub, payload: JSON.parse(payload), opts });
    },
  };
  const app = await buildApp({
    db: seedFixture(openDb(':memory:', { seed: false })), config, now: () => t, webPush,
    fetchImpl: async (url, init) => expo.push(JSON.parse(init.body)),
  });
  const call = (method, url, payload) => app.inject({ method, url: `/api/admin${url}`, headers: admin, payload });
  await call('PUT', '/settings', { maxPizzasPerSlot: 0 });
  const place = async (items = [{ itemId: 1, quantity: 1 }], extra = {}) => {
    const { slots } = (await app.inject({ url: '/api/slots?pizzas=1' })).json();
    const res = await app.inject({
      method: 'POST', url: '/api/orders',
      payload: { customerName: 'Julie Martin', phone: '0611111111', pickupTime: slots[0], paymentMethod: 'on_pickup', items, ...extra },
    });
    assert.equal(res.statusCode, 201, res.body);
    return res.json().order;
  };
  const status = (id, s) => call('PATCH', `/orders/${id}/status`, { status: s });
  const flush = () => app.notifier.flush();
  return { app, clock, expo, web, call, place, status, flush };
}

test('abonnement du patron : clé publique, abonnement valide/invalide, désabonnement', async () => {
  const { call } = await setup();
  const key = (await call('GET', '/push/key')).json();
  assert.deepEqual(key, { publicKey: 'PUBLIC-KEY', devices: 0 });
  assert.equal((await call('POST', '/push/subscribe', { subscription: { ...SUB, endpoint: 'http://non-securise' } })).statusCode, 400);
  assert.equal((await call('POST', '/push/subscribe', { subscription: { endpoint: SUB.endpoint } })).statusCode, 400);
  assert.equal((await call('POST', '/push/subscribe', { subscription: SUB })).statusCode, 201);
  assert.equal((await call('POST', '/push/subscribe', { subscription: SUB })).statusCode, 201); // idempotent
  assert.equal((await call('GET', '/push/key')).json().devices, 1);
  await call('POST', '/push/unsubscribe', { endpoint: SUB.endpoint });
  assert.equal((await call('GET', '/push/key')).json().devices, 0);
});

test('patron : notification à chaque nouvelle commande, avec le détail', async () => {
  const { call, place, flush, web } = await setup();
  await call('POST', '/push/subscribe', { subscription: SUB });
  assert.deepEqual((await call('POST', '/push/test')).json(), { sent: 1 });
  web.calls.length = 0;

  const order = await place([{ itemId: 2, quantity: 2 }, { itemId: 7, quantity: 1 }]);
  await flush();
  assert.equal(web.calls.length, 1);
  const { payload, opts, sub } = web.calls[0];
  assert.equal(payload.title, `🍕 Nouvelle commande n°${order.number}`);
  assert.match(payload.body, /^Julie · retrait \d\d:\d\d · 25,00 € · 2× Reine, 1× Coca-Cola 33cl$/);
  assert.equal(payload.url, '/admin');
  assert.equal(sub.endpoint, SUB.endpoint);
  assert.deepEqual([opts.vapidDetails.publicKey, opts.vapidDetails.subject, opts.urgency], ['PUBLIC-KEY', config.vapidSubject, 'high']);
});

test('patron : pas de notification si coupée, abonnement expiré supprimé', async () => {
  const { call, place, flush, web } = await setup();
  await call('POST', '/push/subscribe', { subscription: SUB });
  await call('PUT', '/settings', { notifyNew: false });
  await place(); await flush();
  assert.equal(web.calls.length, 0);

  await call('PUT', '/settings', { notifyNew: true });
  web.fail = 410; // le téléphone ne reçoit plus : abonnement oublié
  await place(); await flush();
  assert.equal((await call('GET', '/push/key')).json().devices, 0);
});

test('patron : une commande payée en ligne n\'est annoncée qu\'une fois le paiement confirmé', async () => {
  let t = new Date('2026-10-14T10:00:00Z');
  const web = { calls: [] };
  const stripe = {
    paymentIntents: { create: async () => ({ id: 'pi_1', client_secret: 'cs' }) },
    webhooks: { constructEvent: (raw) => JSON.parse(raw) },
  };
  const app = await buildApp({
    db: seedFixture(openDb(':memory:', { seed: false })), now: () => t, stripe, fetchImpl: async () => {},
    config: { ...config, stripePublishableKey: 'pk', stripeWebhookSecret: 'wh' },
    webPush: { generateVAPIDKeys: () => ({ publicKey: 'p', privateKey: 'k' }), sendNotification: async (s, p) => web.calls.push(JSON.parse(p)) },
  });
  await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: admin, payload: { maxPizzasPerSlot: 0 } });
  await app.inject({ method: 'POST', url: '/api/admin/push/subscribe', headers: admin, payload: { subscription: SUB } });
  const { slots } = (await app.inject({ url: '/api/slots' })).json();
  const res = await app.inject({
    method: 'POST', url: '/api/orders',
    payload: { customerName: 'Léa', phone: '0622222222', pickupTime: slots[0], paymentMethod: 'online', items: [{ itemId: 1, quantity: 1 }] },
  });
  const order = res.json().order;
  await app.notifier.flush();
  assert.equal(web.calls.length, 0); // en attente de paiement
  await app.inject({
    method: 'POST', url: '/api/stripe/webhook', headers: { 'stripe-signature': 'x', 'content-type': 'application/json' },
    payload: JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { metadata: { orderId: order.id } } } }),
  });
  await app.notifier.flush();
  assert.equal(web.calls.length, 1);
});

test('client : acceptée, prête, annulée — une notification par changement', async () => {
  const { place, status, flush, expo } = await setup();
  const o = await place([{ itemId: 1, quantity: 1 }], { pushToken: TOKEN });
  await status(o.id, 'preparing'); await status(o.id, 'preparing'); // 2e clic : rien de plus
  await status(o.id, 'ready');
  await flush();
  assert.deepEqual(expo.map((m) => m.title), ['Commande acceptée 👨‍🍳', 'Votre commande est prête 🍕']);
  assert.equal(expo[0].to, TOKEN);
  assert.equal(expo[0].data.orderId, o.id);
  assert.match(expo[0].body, new RegExp(`n°${o.number}.*Retrait à ${o.pickup_time}`));

  const o2 = await place([{ itemId: 1, quantity: 1 }], { pushToken: TOKEN });
  expo.length = 0;
  await status(o2.id, 'cancelled'); await flush();
  assert.deepEqual(expo.map((m) => m.title), ['Commande annulée']);
  const noToken = await place(); // pas de jeton : jamais d'erreur
  await status(noToken.id, 'ready'); await flush();
  assert.equal(expo.length, 1);
});

test('rappels : « bientôt prête » arrive 9 min après le début de préparation, une seule fois', async () => {
  const { place, status, flush, expo, clock, app } = await setup();
  const o = await place([{ itemId: 1, quantity: 1 }], { pushToken: TOKEN });
  await status(o.id, 'preparing'); await flush(); expo.length = 0;
  clock.advance(8);
  assert.equal((await app.notifier.tick()).soon, 0);
  clock.advance(1.5);
  assert.equal((await app.notifier.tick()).soon, 1);
  assert.equal((await app.notifier.tick()).soon, 0);
  await flush();
  assert.deepEqual(expo.map((m) => m.title), ['Bientôt prête ⏳']);
  await status(o.id, 'ready'); // plus de « bientôt prête » une fois prête
});

test('rappels : « votre commande vous attend » 10 min après l\'heure de retrait ou de fin de préparation', async () => {
  const { place, status, flush, expo, clock, app } = await setup();
  const o = await place([{ itemId: 1, quantity: 1 }], { pushToken: TOKEN }); // retrait 12:30
  clock.advance(10); await status(o.id, 'preparing');
  clock.advance(10); await status(o.id, 'ready'); // prête à 12:20, retrait prévu 12:30
  await flush(); expo.length = 0;
  clock.at('2026-10-14T10:39:00Z'); // 12:39 : 9 min après l'heure de retrait
  assert.equal((await app.notifier.tick()).waiting, 0);
  clock.at('2026-10-14T10:41:00Z'); // 12:41
  assert.equal((await app.notifier.tick()).waiting, 1);
  assert.equal((await app.notifier.tick()).waiting, 0);
  await flush();
  assert.deepEqual(expo.map((m) => m.title), ['Votre pizza vous attend 🍕']);
});

test('rappels : invitation à noter 30 min après le retrait, sauf si déjà noté', async () => {
  const { place, status, flush, expo, clock, app } = await setup();
  const a = await place([{ itemId: 1, quantity: 1 }], { pushToken: TOKEN });
  const b = await place([{ itemId: 2, quantity: 1 }], { pushToken: TOKEN });
  await status(a.id, 'done'); await status(b.id, 'done');
  await app.inject({ method: 'POST', url: `/api/orders/${b.id}/ratings`, payload: { ratings: [{ itemId: 2, rating: 5 }] } });
  await flush(); expo.length = 0;
  clock.advance(29);
  assert.equal((await app.notifier.tick()).rate, 0);
  clock.advance(2);
  assert.equal((await app.notifier.tick()).rate, 1); // seulement la commande non notée
  assert.equal((await app.notifier.tick()).rate, 0);
  await flush();
  assert.deepEqual(expo.map((m) => m.title), ['Comment était votre pizza ? ⭐']);
  clock.advance(60 * 25); // trop tard : plus d'invitation
  assert.equal((await app.notifier.tick()).rate, 0);
});

test('patron : alerte retard 5 min après l\'heure de retrait, une seule fois, et coupable dans les réglages', async () => {
  const { call, place, status, flush, web, clock, app } = await setup();
  await call('POST', '/push/subscribe', { subscription: SUB });
  const late = await place(); // retrait 12:30, jamais préparée
  const fine = await place(); await status(fine.id, 'done'); // déjà retirée : jamais en retard
  await flush(); web.calls.length = 0;

  clock.at('2026-10-14T10:34:00Z'); // 12:34
  assert.equal((await app.notifier.tick()).late, 0);
  clock.at('2026-10-14T10:36:00Z'); // 12:36
  assert.equal((await app.notifier.tick()).late, 1);
  assert.equal((await app.notifier.tick()).late, 0);
  await flush();
  assert.equal(web.calls.length, 1);
  assert.equal(web.calls[0].payload.title, `⏰ Commande n°${late.number} en retard`);
  assert.match(web.calls[0].payload.body, /Retrait prévu à \d\d:\d\d pour Julie/);

  const muted = await place(); await call('PUT', '/settings', { notifyLate: false });
  clock.advance(60); web.calls.length = 0;
  assert.equal((await app.notifier.tick()).late, 1); // traitée mais non envoyée
  await flush();
  assert.equal(web.calls.length, 0);
  assert.ok(muted.id);
});

test('patron : bilan du soir une seule fois, 10 min après la fermeture', async () => {
  const { call, place, status, flush, web, clock, app } = await setup();
  await call('POST', '/push/subscribe', { subscription: SUB });
  await call('PUT', '/settings', { notifyLate: false });
  const a = await place([{ itemId: 1, quantity: 1 }]); await status(a.id, 'done'); // 9 €
  const b = await place([{ itemId: 2, quantity: 1 }]); await status(b.id, 'done'); // 11 €
  const c = await place([{ itemId: 4, quantity: 1 }]); await status(c.id, 'cancelled'); // annulée : exclue
  await flush(); web.calls.length = 0;

  clock.at('2026-10-14T21:50:00Z'); // 23:50 : fermeture à 23:45, bilan à 23:55
  assert.equal((await app.notifier.tick()).summary, 0);
  clock.at('2026-10-14T21:56:00Z');
  assert.equal((await app.notifier.tick()).summary, 1);
  assert.equal((await app.notifier.tick()).summary, 0);
  await flush();
  const summaries = web.calls.filter((c) => c.payload.title === '📊 Bilan du jour');
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].payload.body, '2 commandes · 20,00 € · 2 pizzas');
});

test('délai minimum de préparation réglable', async () => {
  const { app, call } = await setup();
  const first = async () => (await app.inject({ url: '/api/slots' })).json().slots[0];
  assert.equal(await first(), '12:30'); // 12:00 + 20 min par défaut
  assert.equal((await call('PUT', '/settings', { leadMinutes: 45 })).statusCode, 200);
  assert.equal(await first(), '12:45');
  assert.equal((await call('PUT', '/settings', { leadMinutes: 3 })).statusCode, 400);
  assert.equal((await call('PUT', '/settings', { leadMinutes: 200 })).statusCode, 400);
  await call('PUT', '/settings', { leadMinutes: null });
  assert.equal(await first(), '12:30');
});

test('chronométrage : étapes horodatées une seule fois, heure de retrait exacte pour la cuisine', async () => {
  const { app, call, place, status, clock } = await setup();
  const o = await place(); // retrait 12:30 = 10:30Z
  clock.advance(5); await status(o.id, 'preparing');
  clock.advance(9); await status(o.id, 'ready');
  clock.advance(3); await status(o.id, 'ready'); // re-clic : l'horodatage d'origine est conservé
  clock.advance(2); await status(o.id, 'done');
  const body = (await call('GET', '/orders')).json();
  const got = body.orders.find((x) => x.id === o.id);
  assert.deepEqual([got.preparing_at, got.ready_at, got.done_at],
    ['2026-10-14T10:05:00.000Z', '2026-10-14T10:14:00.000Z', '2026-10-14T10:19:00.000Z']);
  assert.equal(got.pickup_at, localToDate('Europe/Paris', got.pickup_date, got.pickup_time).toISOString());
  assert.equal(got.pickup_at, '2026-10-14T10:30:00.000Z');
  assert.equal(body.now, '2026-10-14T10:19:00.000Z');
  assert.equal(body.typical_prep_minutes, null); // pas assez de commandes chronométrées
  assert.ok(app);
});
