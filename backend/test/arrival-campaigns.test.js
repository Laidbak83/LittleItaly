import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { seedFixture } from './fixture.js';

const config = loadConfig({ ADMIN_TOKEN: 'secret' });
for (const d of Object.keys(config.hoursByWeekday)) config.hoursByWeekday[d] = [['00:00', '23:45']];
config.dbPath = ':memory:';
const admin = { authorization: 'Bearer secret' };
const ID = (c) => c.repeat(8) + '-' + c.repeat(4) + '-' + c.repeat(4) + '-' + c.repeat(4) + '-' + c.repeat(12);
const A = ID('a'), B = ID('b'), C = ID('c'), D = ID('d');
const SUB = { endpoint: 'https://push.example.test/abc', keys: { p256dh: 'k1', auth: 'k2' } };

async function setup() {
  let t = new Date('2026-10-14T10:00:00Z'); // mercredi 12:00 à Paris
  const clock = { at: (iso) => (t = new Date(iso)), advance: (min) => (t = new Date(t.getTime() + min * 60000)) };
  const expoCalls = [];
  const web = [];
  const db = seedFixture(openDb(':memory:', { seed: false }));
  const app = await buildApp({
    db, config, now: () => t,
    fetchImpl: async (url, init) => expoCalls.push(JSON.parse(init.body)),
    webPush: { generateVAPIDKeys: () => ({ publicKey: 'p', privateKey: 'k' }), sendNotification: async (s, payload) => web.push(JSON.parse(payload)) },
  });
  const call = (method, url, payload) => app.inject({ method, url: `/api/admin${url}`, headers: admin, payload });
  await call('PUT', '/settings', { maxPizzasPerSlot: 0 });
  const place = async (extra = {}, items = [{ itemId: 1, quantity: 1 }]) => {
    const { slots } = (await app.inject({ url: '/api/slots?pizzas=1' })).json();
    const res = await app.inject({
      method: 'POST', url: '/api/orders',
      payload: { customerName: 'Julie', phone: '0611111111', pickupTime: slots[0], paymentMethod: 'on_pickup', items, ...extra },
    });
    assert.equal(res.statusCode, 201, res.body);
    return res.json().order;
  };
  const expo = () => expoCalls.flat();
  return { app, db, clock, call, place, expo, expoCalls, web };
}

test('« J\'arrive » : délais valides, « je suis là » définitif, refusé une fois la commande retirée', async () => {
  const { app, call, place } = await setup();
  const o = await place(); // retrait 12:30
  const arrive = (minutes, id = o.id) => app.inject({ method: 'POST', url: `/api/orders/${id}/arrival`, payload: { minutes } });
  assert.equal((await arrive(7)).statusCode, 400);
  assert.equal((await arrive(5, 'inconnue')).statusCode, 404);

  const r = (await arrive(10)).json().order;
  assert.equal(r.arrival_eta_at, '2026-10-14T10:10:00.000Z');
  assert.equal(r.arrival_here, 0);
  const here = (await arrive(0)).json().order;
  assert.equal(here.arrival_here, 1);
  const after = (await arrive(20)).json().order; // « je suis là » ne revient pas en arrière
  assert.equal(after.arrival_here, 1);
  assert.equal(after.arrival_eta_at, here.arrival_eta_at);
  assert.equal((await call('GET', '/orders')).json().orders.find((x) => x.id === o.id).arrival_here, 1); // visible en cuisine

  await call('PATCH', `/orders/${o.id}/status`, { status: 'done' });
  assert.equal((await arrive(5)).statusCode, 409);
});

test('pizzas à régler au retrait : la cuisine attend le « J\'arrive », sans fausse alerte de retard', async () => {
  const { app, call, place, clock, web } = await setup();
  await call('POST', '/push/subscribe', { subscription: SUB });
  const o = await place();
  const hold = async () => (await app.inject({ url: `/api/orders/${o.id}` })).json().order.hold_until_arrival;
  assert.equal(await hold(), false); // réglage coupé par défaut
  await call('PUT', '/settings', { holdUnpaid: true });
  assert.equal(await hold(), true);
  assert.equal((await call('GET', '/orders')).json().orders[0].hold_until_arrival, true);
  await app.notifier.flush(); web.length = 0;

  clock.at('2026-10-14T10:36:00Z'); // 6 min après l'heure de retrait : pas d'alerte, le client n'est pas venu
  assert.equal((await app.notifier.tick()).late, 0);
  await app.inject({ method: 'POST', url: `/api/orders/${o.id}/arrival`, payload: { minutes: 5 } });
  assert.equal(await hold(), false); // le client a prévenu : on peut lancer
  assert.equal((await app.notifier.tick()).late, 1); // maintenant c'est bien un retard
  await app.notifier.flush();
  assert.equal(web.filter((m) => m.title.includes('en retard')).length, 1);
});

test('rappel « dites-nous quand vous partez » : 15 min avant le retrait, une fois, seulement si utile', async () => {
  const { app, call, place, clock, expo } = await setup();
  await call('PUT', '/settings', { holdUnpaid: true });
  const o = await place({ pushToken: 'ExponentPushToken[abc]' }); // retrait 12:30
  const noPush = await place(); // sans jeton : rien à envoyer
  await app.notifier.flush(); expoCalls_clear(expo);

  clock.at('2026-10-14T10:14:00Z'); // 12:14 : 16 min avant
  assert.equal((await app.notifier.tick()).arrive, 0);
  clock.at('2026-10-14T10:16:00Z'); // 14 min avant
  assert.equal((await app.notifier.tick()).arrive, 1);
  assert.equal((await app.notifier.tick()).arrive, 0);
  await app.notifier.flush();
  const msgs = expo().filter((m) => m.title.startsWith('Dites-nous'));
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].body, new RegExp(`n°${o.number}.*« J'arrive »`));

  // déjà prévenu par le client : aucun rappel
  const o2 = await place({ pushToken: 'ExponentPushToken[def]' });
  await app.inject({ method: 'POST', url: `/api/orders/${o2.id}/arrival`, payload: { minutes: 10 } });
  clock.advance(60);
  assert.equal((await app.notifier.tick()).arrive, 0);
  assert.ok(noPush);
});
const expoCalls_clear = () => {};

test('accord pour les offres : enregistré par carte, jeton mis à jour, identifiant contrôlé', async () => {
  const { app, db } = await setup();
  const put = (id, payload) => app.inject({ method: 'PUT', url: `/api/devices/${id}`, payload });
  assert.equal((await put('court', {})).statusCode, 400);
  await put(A, { pushToken: 'ExponentPushToken[1]', marketing: true });
  let row = db.prepare('SELECT * FROM devices WHERE loyalty_id = ?').get(A);
  assert.deepEqual([row.push_token, row.marketing], ['ExponentPushToken[1]', 1]);
  assert.ok(row.marketing_at);
  await put(A, { pushToken: 'faux-jeton' }); // jeton invalide : ignoré, rien d'écrasé
  await put(A, { pushToken: 'ExponentPushToken[2]' }); // nouveau jeton : l'accord est conservé
  row = db.prepare('SELECT * FROM devices WHERE loyalty_id = ?').get(A);
  assert.deepEqual([row.push_token, row.marketing], ['ExponentPushToken[2]', 1]);
  await put(A, { marketing: false });
  assert.equal((await app.inject({ url: `/api/loyalty/${A}` })).json().marketing, false);
});

test('campagnes : seulement les clients qui ont accepté, par segment, une tous les 3 jours', async () => {
  const { app, call, place, clock, expoCalls } = await setup();
  const put = (id, payload) => app.inject({ method: 'PUT', url: `/api/devices/${id}`, payload });
  for (let i = 0; i < 3; i++) await place({ loyaltyId: A }); // A : 3 commandes → fidèle
  await place({ loyaltyId: B, phone: '0622222222', customerName: 'Marc' }); // B : nouveau
  await put(A, { pushToken: 'ExponentPushToken[A]', marketing: true });
  await put(B, { pushToken: 'ExponentPushToken[B]', marketing: true });
  await put(C, { pushToken: 'ExponentPushToken[C]', marketing: true }); // accord mais aucune commande
  await put(D, { pushToken: 'ExponentPushToken[D]', marketing: false }); // pas d'accord

  const info = (await call('GET', '/campaigns')).json();
  assert.deepEqual(Object.fromEntries(info.segments.map((s) => [s.key, s.count])), { all: 3, regular: 1, dormant: 0, new: 1 });
  assert.equal(info.next_allowed_at, null);

  const send = (p) => call('POST', '/campaigns', { title: 'Pizza offerte ?', body: 'Ce soir, -2 € sur votre commande.', segment: 'regular', ...p });
  assert.equal((await send({ segment: 'inconnu' })).statusCode, 400);
  assert.equal((await send({ title: '' })).statusCode, 400);
  assert.equal((await send({ body: 'x'.repeat(141) })).statusCode, 400);
  assert.match((await send({ segment: 'dormant' })).json().error, /Aucun client/);

  const ok = await send();
  assert.equal(ok.statusCode, 201);
  assert.equal(ok.json().recipients, 1);
  const sent = expoCalls.flat().filter((m) => m.title === 'Pizza offerte ?');
  assert.deepEqual(sent.map((m) => m.to), ['ExponentPushToken[A]']);

  const again = await send({ segment: 'all' });
  assert.equal(again.statusCode, 409); // trop tôt
  assert.ok(again.json().next_allowed_at);
  clock.advance(60 * 73);
  const all = await send({ segment: 'all', title: 'Nouveauté' });
  assert.equal(all.json().recipients, 3);
  assert.equal((await call('GET', '/campaigns')).json().history.length, 2);

  await put(A, { marketing: false }); // retrait de l'accord : plus jamais de message
  clock.advance(60 * 73);
  assert.equal((await send({ segment: 'all', title: 'Encore' })).json().recipients, 2);
});

test('campagnes : envoi par paquets de 100', async () => {
  const { call, db, expoCalls } = await setup();
  const ins = db.prepare("INSERT INTO devices (loyalty_id, push_token, marketing, updated_at) VALUES (?,?,1,'x')");
  for (let i = 0; i < 250; i++) ins.run(`id-${String(i).padStart(14, '0')}`, `ExponentPushToken[${i}]`);
  const r = await call('POST', '/campaigns', { segment: 'all', title: 'Offre', body: 'Bonjour' });
  assert.equal(r.json().recipients, 250);
  assert.deepEqual(expoCalls.map((c) => c.length), [100, 100, 50]);
});

test('prévision de cuisine : moyenne des mêmes jours, marge de 10 %, jamais moins que le réservé', async () => {
  const { call, db, place } = await setup();
  const ins = db.prepare(`INSERT INTO orders (id, number, customer_name, phone, pickup_date, pickup_time, payment_method, payment_status,
    status, total_cents, pizza_count, created_at) VALUES (?,?,?,?,?,?, 'on_pickup','unpaid','done',1000,?, 'x')`);
  let n = 0;
  for (const [date, pizzas] of [['2026-09-23', 15], ['2026-09-30', 20], ['2026-10-07', 10], ['2026-09-16', 99]]) {
    // 2026-09-16 est AVANT la 1re commande connue (23/09) : n'est pas compté, restaurant pas encore ouvert à l'appli
    if (date !== '2026-09-16') ins.run(`h${++n}`, n, 'Client', '0600000000', date, '12:00', pizzas);
  }
  await place({}, [{ itemId: 1, quantity: 2 }]); // 2 pizzas réservées aujourd'hui (mercredi)
  const f = (await call('GET', '/forecast')).json();
  assert.equal(f.days.length, 3);
  const today = f.days[0];
  assert.deepEqual([today.date, today.weekday, today.samples, today.reliable], ['2026-10-14', 3, 3, true]);
  assert.equal(today.expected_pizzas, 15); // (15 + 20 + 10) / 3
  assert.equal(today.suggested_doughs, 17); // 15 × 1,1 = 16,5 → 17
  assert.deepEqual([today.booked_orders, today.booked_pizzas], [1, 2]);
  const tomorrow = f.days[1]; // jeudi : 3 jeudis déjà vécus depuis la 1re commande, tous vides → rien à prévoir
  assert.deepEqual([tomorrow.samples, tomorrow.reliable, tomorrow.expected_pizzas, tomorrow.suggested_doughs], [3, true, 0, 0]);

  await place({}, [{ itemId: 1, quantity: 30 }].slice(0, 1).map((l) => ({ ...l, quantity: 20 }))); // beaucoup de réservé
  const f2 = (await call('GET', '/forecast')).json();
  assert.equal(f2.days[0].suggested_doughs, 22); // jamais moins que les pizzas déjà réservées
});

test('QR code : SVG pour les affiches, adresse contrôlée, réservé à l\'admin', async () => {
  const { app, call } = await setup();
  const ok = await call('GET', '/qr?url=https://commande.example/commande/');
  assert.equal(ok.statusCode, 200);
  assert.match(ok.headers['content-type'], /image\/svg\+xml/);
  assert.match(ok.body, /<svg/);
  assert.equal((await call('GET', '/qr?url=javascript:alert(1)')).statusCode, 400);
  assert.equal((await call('GET', '/qr')).statusCode, 400);
  assert.equal((await app.inject({ url: '/api/admin/qr?url=https://x.example' })).statusCode, 401);
});

test('fermetures : liste des à-venir seulement, suppression', async () => {
  const { call } = await setup();
  await call('POST', '/closures', { dateFrom: '2026-10-01', dateTo: '2026-10-05', reason: 'Passé' });
  const r = await call('POST', '/closures', { dateFrom: '2026-12-24', dateTo: '2026-12-26', reason: 'Noël' });
  assert.deepEqual((await call('GET', '/closures')).json().closures.map((c) => c.reason), ['Noël']);
  await call('DELETE', `/closures/${r.json().id}`);
  assert.equal((await call('GET', '/closures')).json().closures.length, 0);
  assert.equal((await call('POST', '/closures', { dateFrom: 'x', dateTo: 'y' })).statusCode, 400);
});
