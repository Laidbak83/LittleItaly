import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { seedFixture } from './fixture.js';

// Menu de test : 1 Margherita 9 €, 2 Reine 11 €, 4 Calzone 12 €, 5 4 fromages 13 €, 7 Coca 3 € ; supplément 1 = Œuf 1 €.
const config = loadConfig({ ADMIN_TOKEN: 'secret' });
for (const d of Object.keys(config.hoursByWeekday)) config.hoursByWeekday[d] = [['00:00', '23:45']];
config.dbPath = ':memory:';
const admin = { authorization: 'Bearer secret' };
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TOMORROW = '2026-10-15'; // jeudi (aujourd'hui : mercredi 14)

async function setup(opts = {}) {
  let t = new Date('2026-10-14T10:00:00Z'); // mercredi 12:00 à Paris
  const clock = { advanceDays: (n) => (t = new Date(t.getTime() + n * 86400000)), advanceMinutes: (n) => (t = new Date(t.getTime() + n * 60000)) };
  const expo = [];
  const db = seedFixture(openDb(':memory:', { seed: false }));
  const app = await buildApp({
    db, config, now: () => t,
    fetchImpl: async (url, init) => expo.push(...[].concat(JSON.parse(init.body))), ...opts,
  });
  const call = (method, url, payload) => app.inject({ method, url: `/api/admin${url}`, headers: admin, payload });
  await call('PUT', '/settings', { maxPizzasPerSlot: 0 });
  const order = async (items, extra = {}, expectStatus = 201) => {
    const { slots } = (await app.inject({ url: `/api/slots?pizzas=1${extra.pickupDate ? `&date=${extra.pickupDate}` : ''}` })).json();
    const res = await app.inject({
      method: 'POST', url: '/api/orders',
      payload: { customerName: 'Julie', phone: '0611111111', pickupTime: slots[0], paymentMethod: 'on_pickup', items, ...extra },
    });
    assert.equal(res.statusCode, expectStatus, res.body);
    return res.json().order ?? res.json();
  };
  const get = async (url) => (await app.inject({ url })).json();
  return { app, db, clock, expo, call, order, get };
}

test('épuisé aujourd\'hui : bloque les commandes du jour, pas celles de demain, repart seul le lendemain', async () => {
  const { call, order, get, clock } = await setup();
  await call('PATCH', '/menu/2', { soldOutToday: true });
  await call('PATCH', '/supplements/1', { soldOutToday: true });
  const menu = await get('/api/menu');
  assert.equal(menu.items.find((i) => i.id === 2).sold_out, true);
  assert.equal(menu.items.find((i) => i.id === 1).sold_out, false);
  assert.equal(menu.supplements.find((s) => s.id === 1).sold_out, true);

  assert.match((await order([{ itemId: 2, quantity: 1 }], {}, 400)).error, /Reine est épuisé aujourd'hui/);
  assert.match((await order([{ itemId: 1, quantity: 1, extras: [1] }], {}, 400)).error, /Œuf est épuisé/);
  assert.match((await order([{ comboId: 1, quantity: 1, picks: [2, 7] }], {}, 400)).error, /Reine est épuisé/);
  await order([{ itemId: 2, quantity: 1 }], { pickupDate: TOMORROW }); // demain : disponible

  clock.advanceDays(1); // le lendemain, l'épuisement est terminé sans rien faire
  assert.equal((await get('/api/menu')).items.find((i) => i.id === 2).sold_out, false);
  await order([{ itemId: 2, quantity: 1 }]);

  await call('PATCH', '/menu/2', { soldOutToday: true });
  await call('PATCH', '/menu/2', { soldOutToday: false });
  await order([{ itemId: 2, quantity: 1 }]);
});

test('précommande : jours proposés, créneaux d\'un autre jour, capacité par jour, fermetures, bouton « fermé »', async () => {
  const { app, call, order, get } = await setup();
  const s = await get('/api/slots');
  assert.equal(s.days.length, 8); // aujourd'hui + 7 jours
  assert.equal(s.days[0].date, '2026-10-14');
  const tomorrow = await get(`/api/slots?date=${TOMORROW}`);
  assert.equal(tomorrow.slots[0], '00:00'); // pas de délai de préparation un autre jour
  assert.equal(s.slots[0], '12:30');

  const o = await order([{ itemId: 1, quantity: 1 }], { pickupDate: TOMORROW });
  assert.equal(o.pickup_date, TOMORROW);
  assert.equal(o.number, 1); // numérotation par jour de retrait
  assert.equal(o.pickup_at, '2026-10-14T22:00:00.000Z'.replace('14T22', '14T22') && o.pickup_at); // champ présent

  const bad = (pickupDate) => app.inject({ method: 'POST', url: '/api/orders', payload: { customerName: 'Julie', phone: '0611111111', pickupTime: '12:00', paymentMethod: 'on_pickup', pickupDate, items: [{ itemId: 1, quantity: 1 }] } });
  assert.equal((await bad('2026-10-13')).statusCode, 400); // hier
  assert.equal((await bad('2026-10-22')).statusCode, 400); // trop loin (+8 jours)
  assert.equal((await bad('pas-une-date')).statusCode, 400);
  assert.equal((await get('/api/slots?date=nimporte')).error, 'Date invalide');

  // capacité : par créneau ET par jour
  await call('PUT', '/settings', { maxPizzasPerSlot: 2 });
  await order([{ itemId: 1, quantity: 2 }], { pickupDate: TOMORROW, pickupTime: '12:00' });
  const full = await app.inject({ method: 'POST', url: '/api/orders', payload: { customerName: 'Julie', phone: '0611111111', pickupTime: '12:00', paymentMethod: 'on_pickup', pickupDate: TOMORROW, items: [{ itemId: 1, quantity: 1 }] } });
  assert.match(full.json().error, /complet/);
  assert.ok((await get(`/api/slots?date=${TOMORROW}&pizzas=1`)).slots.length > 0);
  await order([{ itemId: 1, quantity: 2 }]); // aujourd'hui, même heure : indépendant

  // fermeture exceptionnelle demain
  assert.equal((await call('POST', '/closures', { dateFrom: TOMORROW, dateTo: TOMORROW, reason: 'Congés' })).statusCode, 201);
  const closed = await get(`/api/slots?date=${TOMORROW}`);
  assert.deepEqual([closed.slots.length, closed.closed], [0, 'Congés']);
  assert.equal((await get('/api/slots')).days[1].closed, 'Congés');
  const res = await app.inject({ method: 'POST', url: '/api/orders', payload: { customerName: 'Julie', phone: '0611111111', pickupTime: '13:00', paymentMethod: 'on_pickup', pickupDate: TOMORROW, items: [{ itemId: 1, quantity: 1 }] } });
  assert.match(res.json().error, /fermé ce jour-là \(Congés\)/);
  assert.equal((await get('/api/config')).closures[0].reason, 'Congés');

  // « Fermé » (rush) ne bloque que les commandes du jour
  await call('POST', '/closures', { dateFrom: '2026-10-16', dateTo: '2026-10-16' });
  await call('PUT', '/settings', { ordersOpen: false, maxPizzasPerSlot: 0 });
  assert.equal((await get('/api/slots')).slots.length, 0);
  await order([{ itemId: 1, quantity: 1 }], { pickupDate: '2026-10-17' });
  await order([{ itemId: 1, quantity: 1 }], {}, 423);

  // jours à l'avance réglables
  await call('PUT', '/settings', { ordersOpen: true, maxAdvanceDays: 0 });
  assert.equal((await get('/api/slots')).days.length, 1);
  assert.equal((await get(`/api/slots?date=${TOMORROW}`)).slots.length, 0);
  assert.equal((await call('POST', '/closures', { dateFrom: '2026-10-20', dateTo: '2026-10-19' })).statusCode, 400);
});

test('offres heures creuses : fenêtre, jours, minimum, meilleure offre, créneaux annotés', async () => {
  const { app, call, order, get } = await setup();
  assert.equal((await call('POST', '/offers', { label: 'Goûter', startTime: '14:00', endTime: '18:00', discountCents: 100, minOrderCents: 1000 })).statusCode, 201);
  assert.equal((await call('POST', '/offers', { label: 'Jeudi', startTime: '14:00', endTime: '16:00', weekdays: [4], discountCents: 250 })).statusCode, 201);
  const bad = (p) => call('POST', '/offers', { label: 'X', startTime: '14:00', endTime: '18:00', discountCents: 100, ...p });
  assert.equal((await bad({ endTime: '13:00' })).statusCode, 400);
  assert.equal((await bad({ discountCents: 0 })).statusCode, 400);
  assert.equal((await bad({ startTime: '25:00' })).statusCode, 400);
  assert.equal((await bad({ weekdays: [9] })).statusCode, 400);
  assert.equal((await bad({ label: '' })).statusCode, 400);

  const today = await get('/api/slots'); // mercredi : seule l'offre « Goûter »
  assert.deepEqual(today.offers['15:00'], { label: 'Goûter', discount_cents: 100, min_order_cents: 1000 });
  assert.equal(today.offers['13:45'], undefined);
  assert.equal(today.offers['18:00'], undefined); // la fin est exclue
  const thu = await get(`/api/slots?date=${TOMORROW}`); // jeudi : « Jeudi » (−2,50 €) l'emporte entre 14 h et 16 h
  assert.equal(thu.offers['15:00'].discount_cents, 250);
  assert.equal(thu.offers['16:00'].label, 'Goûter');

  const o = await order([{ itemId: 2, quantity: 1 }], { pickupTime: '15:00' }); // 11 € ≥ 10 €
  assert.deepEqual([o.offer_discount_cents, o.offer_label, o.total_cents], [100, 'Goûter', 1000]);
  const small = await order([{ itemId: 1, quantity: 1 }], { pickupTime: '15:00' }); // 9 € < minimum
  assert.deepEqual([small.offer_discount_cents, small.total_cents], [0, 900]);
  const out = await order([{ itemId: 2, quantity: 1 }], { pickupTime: '19:00' });
  assert.equal(out.total_cents, 1100);
  const thuOrder = await order([{ itemId: 2, quantity: 1 }], { pickupDate: TOMORROW, pickupTime: '15:00' });
  assert.deepEqual([thuOrder.offer_label, thuOrder.total_cents], ['Jeudi', 850]);

  // la remise ne peut pas dépasser le montant de la commande
  await call('POST', '/offers', { label: 'Géant', startTime: '20:00', endTime: '21:00', discountCents: 2000 });
  assert.equal((await order([{ itemId: 8, quantity: 1 }], { pickupTime: '20:00' })).total_cents, 0);

  // modification, désactivation, suppression
  const { offers } = (await call('GET', '/offers')).json();
  const goûter = offers.find((x) => x.label === 'Goûter');
  assert.equal((await call('PATCH', `/offers/${goûter.id}`, { active: false })).statusCode, 200);
  assert.equal((await get('/api/slots')).offers['15:00'], undefined);
  assert.equal((await call('PATCH', `/offers/${goûter.id}`, { discountCents: 150, active: true })).statusCode, 200);
  assert.equal((await get('/api/slots')).offers['15:00'].discount_cents, 150);
  assert.equal((await call('PATCH', `/offers/${goûter.id}`, { endTime: '10:00' })).statusCode, 400);
  assert.equal((await call('PATCH', '/offers/999', { active: false })).statusCode, 404);
  await call('DELETE', `/offers/${goûter.id}`);
  assert.equal((await get('/api/slots')).offers['15:00'], undefined);
  assert.ok(app);
});

test('devis : le total exact avec toutes les remises, identique à la commande', async () => {
  const { app, call, order } = await setup();
  await call('PUT', '/settings', { welcomeCents: 200 });
  await call('POST', '/offers', { label: 'Goûter', startTime: '14:00', endTime: '18:00', discountCents: 100 });
  const body = { items: [{ itemId: 2, quantity: 1 }], pickupTime: '15:00', loyaltyId: A, phone: '0611111111' };
  const q = (await app.inject({ method: 'POST', url: '/api/quote', payload: body })).json();
  assert.deepEqual(
    [q.subtotal_cents, q.welcome_cents, q.offer, q.reward_cents, q.total_cents, q.requires_online, q.pizzas],
    [1100, 200, { id: 1, label: 'Goûter', cents: 100 }, 0, 800, false, 1],
  );
  const o = await order(body.items, { pickupTime: '15:00', loyaltyId: A });
  assert.equal(o.total_cents, q.total_cents);
  const bad = await app.inject({ method: 'POST', url: '/api/quote', payload: { items: [] } });
  assert.equal(bad.statusCode, 400);
});

test('offre de bienvenue : première commande seulement, par carte ET par téléphone, minimum respecté', async () => {
  const { app, call, order, get } = await setup();
  assert.equal((await call('PUT', '/settings', { welcomeCents: 5000 })).statusCode, 400);
  await call('PUT', '/settings', { welcomeCents: 200, welcomeMinCents: 1000 });
  assert.deepEqual((await get('/api/config')).welcome, { cents: 200, min_cents: 1000 });
  assert.deepEqual((await get(`/api/loyalty/${A}`)).welcome, { cents: 200, min_cents: 1000 });

  const small = await order([{ itemId: 1, quantity: 1 }], { loyaltyId: A }); // 9 € < 10 € : pas de remise, mais ce n'est pas "consommé"
  assert.equal(small.welcome_discount_cents, 0);
  // « première commande » = aucune commande valide avant : la petite compte déjà
  const second = await order([{ itemId: 2, quantity: 1 }], { loyaltyId: A });
  assert.equal(second.welcome_discount_cents, 0);
  assert.equal((await get(`/api/loyalty/${A}`)).welcome, null);

  const fresh = await order([{ itemId: 2, quantity: 1 }], { loyaltyId: B, phone: '0699999999' });
  assert.deepEqual([fresh.welcome_discount_cents, fresh.total_cents], [200, 900]);
  const sameCard = await order([{ itemId: 2, quantity: 1 }], { loyaltyId: B, phone: '0688888888' });
  assert.equal(sameCard.welcome_discount_cents, 0);
  const samePhone = await order([{ itemId: 2, quantity: 1 }], { loyaltyId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', phone: '0699999999' });
  assert.equal(samePhone.welcome_discount_cents, 0); // nouvelle carte mais même téléphone

  // une commande annulée ne « consomme » pas l'offre
  const cancelled = await order([{ itemId: 2, quantity: 1 }], { loyaltyId: 'dddddddd-dddd-dddd-dddd-dddddddddddd', phone: '0677777777' });
  await call('PATCH', `/orders/${cancelled.id}/status`, { status: 'cancelled' });
  assert.equal((await order([{ itemId: 2, quantity: 1 }], { loyaltyId: 'dddddddd-dddd-dddd-dddd-dddddddddddd', phone: '0677777777' })).welcome_discount_cents, 200);
  assert.ok(app);
});

test('parrainage : code ami, première commande seulement, tampons au parrain quand le filleul retire sa commande', async () => {
  const { call, order, get, expo, app } = await setup();
  await call('PUT', '/settings', { welcomeCents: 200 });
  const tokenA = 'ExponentPushToken[parrain]';
  await app.inject({ method: 'PUT', url: `/api/devices/${A}`, payload: { pushToken: tokenA } });
  const code = (await get(`/api/loyalty/${A}`)).referral_code;
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal((await get(`/api/loyalty/${A}`)).referral_code, code); // stable
  assert.equal((await get('/api/config')).referral.stamps, 3);

  const use = (referralCode, loyaltyId = B, phone = '0699999999') =>
    app.inject({ method: 'POST', url: '/api/orders', payload: { customerName: 'Léa', phone, pickupTime: '23:00', paymentMethod: 'on_pickup', loyaltyId, referralCode, items: [{ itemId: 2, quantity: 1 }] } });
  assert.match((await use('ZZZZZZ')).json().error, /Code ami inconnu/);
  assert.match((await use(code, A, '0611111111')).json().error, /propre code/);
  const res = await use(code.toLowerCase());
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().order.welcome_discount_cents, 200); // le filleul profite aussi de l'offre de bienvenue
  assert.match((await use(code, B, '0688888888')).json().error, /première commande/); // 2e commande de B

  await call('PATCH', `/orders/${res.json().order.id}/status`, { status: 'done' });
  await call('PATCH', `/orders/${res.json().order.id}/status`, { status: 'done' }); // idempotent
  expo.length = 0;
  const loyalty = await get(`/api/loyalty/${A}`);
  assert.equal(loyalty.progress, 3);
  await app.notifier.flush();

  // parrainage désactivé
  await call('PUT', '/settings', { referralStamps: 0 });
  assert.equal((await get(`/api/loyalty/${A}`)).referral_code, null);
  assert.equal((await get('/api/config')).referral, null);
  assert.match((await use(code, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '0655555555')).json().error, /pas proposé/);
});

test('parrainage : le parrain est prévenu par notification', async () => {
  const { call, order, expo, app } = await setup();
  const tokenA = 'ExponentPushToken[parrain]';
  await app.inject({ method: 'PUT', url: `/api/devices/${A}`, payload: { pushToken: tokenA } });
  const code = (await app.inject({ url: `/api/loyalty/${A}` })).json().referral_code;
  const o = await order([{ itemId: 2, quantity: 1 }], { loyaltyId: B, phone: '0699999999', referralCode: code });
  await call('PATCH', `/orders/${o.id}/status`, { status: 'done' });
  await app.notifier.flush();
  const msg = expo.find((m) => m.title === 'Parrainage 🎉');
  assert.equal(msg.to, tokenA);
  assert.match(msg.body, /\+3 tampons/);
});

test('paiement en ligne demandé au-delà d\'un montant (seulement s\'il est possible)', async () => {
  const stripe = { paymentIntents: { create: async () => ({ id: 'pi', client_secret: 'cs' }) }, webhooks: {} };
  const online = await setup({ stripe, config: { ...config, stripePublishableKey: 'pk' } });
  await online.call('PUT', '/settings', { prepayOverCents: 3000 });
  const big = await online.app.inject({ method: 'POST', url: '/api/quote', payload: { items: [{ itemId: 5, quantity: 3 }] } }); // 39 €
  assert.equal(big.json().requires_online, true);
  const refused = await online.order([{ itemId: 5, quantity: 3 }], {}, 400);
  assert.equal(refused.requires_online, true);
  assert.match(refused.error, /30,00 €.*paiement en ligne/);
  await online.order([{ itemId: 5, quantity: 3 }], { paymentMethod: 'online' });
  await online.order([{ itemId: 5, quantity: 2 }]); // 26 € : sous le seuil
  assert.equal((await online.get('/api/config')).prepayOverCents, 3000);

  const offline = await setup(); // pas de Stripe : impossible d'exiger, on laisse passer
  await offline.call('PUT', '/settings', { prepayOverCents: 3000 });
  await offline.order([{ itemId: 5, quantity: 3 }]);
  assert.equal((await offline.get('/api/config')).prepayOverCents, 0);
});

test('réglages : validation des nouveaux champs', async () => {
  const { call, get } = await setup();
  const put = (p) => call('PUT', '/settings', p).then((r) => r.statusCode);
  assert.equal(await put({ maxAdvanceDays: 40 }), 400);
  assert.equal(await put({ referralStamps: 11 }), 400);
  assert.equal(await put({ prepayOverCents: -1 }), 400);
  assert.equal(await put({ info: { phone: 'abc' } }), 400);
  assert.equal(await put({ info: { mapsUrl: 'http://pas-securise' } }), 400);
  assert.equal(await put({ publicUrl: 'ftp://x' }), 400);
  assert.equal(await put({ info: { address: ' 1 rue du Test ', phone: '04 94 70 58 99', mapsUrl: 'https://maps.example/x', reviewUrl: 'https://g.page/r/abc' }, publicUrl: 'https://commande.example', holdUnpaid: true }), 200);
  const cfg = await get('/api/config');
  assert.deepEqual(cfg.info, { address: '1 rue du Test', phone: '04 94 70 58 99', mapsUrl: 'https://maps.example/x', reviewUrl: 'https://g.page/r/abc' });
  assert.equal(cfg.holdUnpaid, true);
  assert.ok(cfg.hours['3'].length === 1);
});
