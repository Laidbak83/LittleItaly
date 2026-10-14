import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { seedFixture } from './fixture.js';

// Menu de test (fixture) : 1 Margherita 9 €, 2 Reine 11 €, 4 Calzone 12 €, 5 4 fromages 13 €, 7 Coca 3 €.
const config = loadConfig({ ADMIN_TOKEN: 'secret' });
for (const d of Object.keys(config.hoursByWeekday)) config.hoursByWeekday[d] = [['00:00', '23:45']];
config.dbPath = ':memory:';
const admin = { authorization: 'Bearer secret' };
const A = '0611111111';
const B = '0622222222';

async function setup(start = '2026-10-12T10:00:00Z') {
  let t = new Date(start); // lundi 12:00 à Paris
  const clock = { advanceDays: (n) => (t = new Date(t.getTime() + n * 86400000)), advanceMinutes: (n) => (t = new Date(t.getTime() + n * 60000)) };
  const app = await buildApp({ db: seedFixture(openDb(':memory:', { seed: false })), config, now: () => t, fetchImpl: async () => {} });
  const put = (url, payload) => app.inject({ method: 'PUT', url: `/api/admin${url}`, headers: admin, payload });
  await put('/settings', { maxPizzasPerSlot: 0, halfAndHalf: true });
  const place = async (items, { name = 'Julie', phone = A, status } = {}) => {
    const { slots } = (await app.inject({ url: '/api/slots?pizzas=1' })).json();
    const res = await app.inject({
      method: 'POST', url: '/api/orders',
      payload: { customerName: name, phone, pickupTime: slots[0], paymentMethod: 'on_pickup', items },
    });
    assert.equal(res.statusCode, 201, res.body);
    const order = res.json().order;
    if (status) await app.inject({ method: 'PATCH', url: `/api/admin/orders/${order.id}/status`, headers: admin, payload: { status } });
    return order;
  };
  const get = async (url, headers) => (await app.inject({ url, headers })).json();
  return { app, clock, put, place, get };
}

// Scénario sur 3 jours : lun (1 commande), mar (2), mer (2) + une commande annulée.
async function scenario(ctx) {
  const { place, clock, app } = ctx;
  await place([{ itemId: 2, quantity: 2 }], { status: 'done' }); // A : 22 €
  clock.advanceDays(1);
  await place([{ itemId: 1, quantity: 1 }], { status: 'done' }); // A : 9 €
  await place([{ comboId: 1, quantity: 1, picks: [5, 7] }], { name: 'Marc', phone: B, status: 'done' }); // B : 11 €
  clock.advanceDays(1);
  await place([{ itemId: 1, quantity: 1, halfItemId: 5 }], { name: 'Marc', phone: B }); // B : 13 € (½ + ½)
  const last = await place([{ itemId: 4, quantity: 1 }]); // A : 12 €
  const cancelled = await place([{ itemId: 6, quantity: 3 }]);
  await app.inject({ method: 'PATCH', url: `/api/admin/orders/${cancelled.id}/status`, headers: admin, payload: { status: 'cancelled' } });
  return { last };
}

test('stats : totaux, courbe par jour sans trou, annulées exclues, comparaison à la période précédente', async () => {
  const ctx = await setup();
  await scenario(ctx);
  const s = await ctx.get('/api/admin/stats?days=7', admin);
  assert.equal(s.totals.orders, 5);
  assert.equal(s.totals.revenue_cents, 2200 + 900 + 1100 + 1300 + 1200);
  assert.equal(s.totals.pizzas, 6);
  assert.equal(s.totals.avg_basket_cents, Math.round(6700 / 5));
  assert.equal(s.daily.length, 7);
  assert.deepEqual(s.daily.slice(-3).map((d) => [d.date, d.orders, d.revenue_cents]), [
    ['2026-10-12', 1, 2200], ['2026-10-13', 2, 2000], ['2026-10-14', 2, 2500],
  ]);
  assert.equal(s.daily[0].orders, 0); // jours sans commande présents, à zéro
  assert.equal(s.hourly.reduce((n, h) => n + h.orders, 0), 5);
  assert.equal(s.weekday[1].orders, 1); // lundi
  assert.equal(s.weekday[3].orders, 2); // mercredi
  assert.equal(s.today.orders, 2);
  assert.equal(s.today.in_progress, 2); // les 2 de mercredi ; lundi et mardi sont retirées, l'annulée ne compte pas
  const prev = await ctx.get('/api/admin/stats?days=3', admin);
  assert.equal(prev.totals.orders, 5);
  assert.equal(prev.previous.orders, 0);
});

test('stats : ventes par article (formules et moitié-moitié comptés au prorata)', async () => {
  const ctx = await setup();
  await scenario(ctx);
  const { topItems } = await ctx.get('/api/admin/stats?days=7', admin);
  const by = Object.fromEntries(topItems.map((i) => [i.name, i.units]));
  assert.equal(topItems[0].name, 'Reine');
  assert.equal(by.Reine, 2);
  assert.equal(by.Margherita, 1.5); // 1 + ½
  assert.equal(by['4 fromages'], 1.5); // 1 (formule) + ½
  assert.equal(by['Coca-Cola 33cl'], 1);
  assert.equal(by.Calzone, 1);
  assert.equal(by.Diavola, undefined); // commande annulée
});

test('stats : clients nouveaux / fidèles et taux de retour', async () => {
  const ctx = await setup();
  await scenario(ctx);
  const week = await ctx.get('/api/admin/stats?days=7', admin);
  assert.deepEqual([week.customers.total, week.customers.new, week.customers.returning, week.customers.repeat_rate], [2, 2, 0, 1]);
  const day = await ctx.get('/api/admin/stats?days=1', admin);
  assert.deepEqual([day.customers.active, day.customers.new, day.customers.returning], [2, 0, 2]);
  assert.equal((await ctx.app.inject({ url: '/api/admin/stats?days=0', headers: admin })).statusCode, 400);
  assert.equal((await ctx.app.inject({ url: '/api/admin/stats' })).statusCode, 401);
});

test('clients : fichier, pizza préférée, segments, notes, détail', async () => {
  const ctx = await setup();
  await scenario(ctx);
  let { customers } = await ctx.get('/api/admin/customers', admin);
  const a = customers.find((c) => c.phone === A);
  const b = customers.find((c) => c.phone === B);
  assert.deepEqual([a.orders, a.spent_cents, a.favorite, a.segment], [3, 4300, 'Reine', 'regular']);
  assert.deepEqual([b.orders, b.spent_cents, b.favorite, b.segment, b.name], [2, 2400, '4 fromages', 'occasional', 'Marc']);
  assert.equal(customers[0].phone, A); // trié par dépense

  assert.equal((await ctx.put(`/customers/${A}/note`, { note: 'Allergique aux noix' })).statusCode, 200);
  assert.equal((await ctx.put('/customers/abc/note', { note: 'x' })).statusCode, 400);
  const detail = await ctx.get(`/api/admin/customers/${A}`, admin);
  assert.equal(detail.note, 'Allergique aux noix');
  assert.equal(detail.orders.length, 3);
  assert.equal(detail.orders[0].items[0].name, 'Calzone');
  assert.equal(detail.favorites[0].name, 'Reine');
  assert.equal((await ctx.app.inject({ url: '/api/admin/customers/0699999999', headers: admin })).statusCode, 404);

  ctx.clock.advanceDays(45); // clients « à relancer »
  customers = (await ctx.get('/api/admin/customers', admin)).customers;
  assert.ok(customers.every((c) => c.segment === 'dormant'));
});

test('avis : seulement après le retrait, une fois par pizza, moyenne visible dans la carte et les stats', async () => {
  const ctx = await setup();
  const order = await ctx.place([{ itemId: 1, quantity: 1, halfItemId: 5 }, { itemId: 7, quantity: 1 }], { name: 'Julie Martin' });
  const rate = (payload, id = order.id) => ctx.app.inject({ method: 'POST', url: `/api/orders/${id}/ratings`, payload });

  assert.equal((await rate({ ratings: [{ itemId: 1, rating: 5 }] })).statusCode, 409); // pas encore retirée
  assert.equal((await ctx.get(`/api/orders/${order.id}`)).order.rateable, undefined);

  await ctx.app.inject({ method: 'PATCH', url: `/api/admin/orders/${order.id}/status`, headers: admin, payload: { status: 'done' } });
  const o = (await ctx.get(`/api/orders/${order.id}`)).order;
  assert.deepEqual(o.rateable.map((r) => r.name).sort(), ['4 fromages', 'Margherita']); // pas la boisson

  assert.equal((await rate({ ratings: [{ itemId: 7, rating: 5 }] })).statusCode, 400); // une boisson n'est pas notable
  assert.equal((await rate({ ratings: [{ itemId: 1, rating: 6 }] })).statusCode, 400);
  assert.equal((await rate({ ratings: [{ itemId: 1, rating: 5 }, { itemId: 1, rating: 4 }] })).statusCode, 400);
  assert.equal((await rate({ ratings: [] })).statusCode, 400);
  assert.equal((await rate({ ratings: [{ itemId: 1, rating: 5 }] }, 'inconnu')).statusCode, 404);

  assert.equal((await rate({ ratings: [{ itemId: 1, rating: 5 }, { itemId: 5, rating: 4 }], comment: '  Délicieuse !  ' })).statusCode, 201);
  assert.equal((await rate({ ratings: [{ itemId: 1, rating: 1 }] })).statusCode, 409); // déjà noté
  assert.deepEqual((await ctx.get(`/api/orders/${order.id}`)).order.ratings.map((r) => r.rating).sort(), [4, 5]);

  const menu = await ctx.get('/api/menu');
  const m = menu.items.find((i) => i.id === 1);
  assert.deepEqual([m.rating_avg, m.rating_count], [5, 1]);
  assert.equal(menu.items.find((i) => i.id === 2).rating_count, 0);

  const s = await ctx.get('/api/admin/stats?days=7', admin);
  assert.deepEqual([s.ratings.average, s.ratings.count], [4.5, 2]);
  assert.equal(s.ratings.recent[0].comment, 'Délicieuse !');
  assert.equal(s.ratings.recent[0].first_name, 'Julie'); // jamais le nom de famille ni le téléphone
  assert.equal(JSON.stringify(s.ratings.recent).includes(A), false);
});

test('pizza de la semaine : prix promo appliqué par le serveur, expire à la date de fin', async () => {
  const ctx = await setup();
  const featured = { featuredItemId: 2, featuredPriceCents: 900, featuredNote: 'Offre de la semaine', featuredUntil: '2026-10-16' };
  assert.equal((await ctx.put('/settings', featured)).statusCode, 200);

  const menu = await ctx.get('/api/menu');
  assert.deepEqual(menu.featured, { itemId: 2, note: 'Offre de la semaine', until: '2026-10-16' });
  const reine = menu.items.find((i) => i.id === 2);
  assert.deepEqual([reine.price_cents, reine.regular_price_cents], [900, 1100]);

  assert.equal((await ctx.place([{ itemId: 2, quantity: 2, extras: [1] }])).total_cents, 2 * (900 + 100)); // promo + supplément
  assert.equal((await ctx.place([{ itemId: 1, quantity: 1, halfItemId: 2 }])).total_cents, 900); // max(900 Margherita, 900 promo Reine)

  ctx.clock.advanceDays(5); // 17 octobre : terminée
  assert.equal((await ctx.get('/api/menu')).featured, null);
  assert.equal((await ctx.get('/api/menu')).items.find((i) => i.id === 2).price_cents, 1100);
  assert.equal((await ctx.place([{ itemId: 2, quantity: 1 }])).total_cents, 1100);

  assert.equal((await ctx.put('/settings', { featuredItemId: 999 })).statusCode, 400);
  assert.equal((await ctx.put('/settings', { featuredItemId: 2, featuredUntil: 'bientôt' })).statusCode, 400);
  assert.equal((await ctx.put('/settings', { featuredItemId: 2, featuredPriceCents: -5 })).statusCode, 400);
  await ctx.put('/settings', { featuredItemId: 2, featuredNote: 'Sans promo' }); // sans prix promo : simple mise en avant
  const plain = await ctx.get('/api/menu');
  assert.equal(plain.featured.itemId, 2);
  assert.equal(plain.items.find((i) => i.id === 2).regular_price_cents, null);
  await ctx.put('/settings', { featuredItemId: null });
  assert.equal((await ctx.get('/api/menu')).featured, null);
});

test('best-sellers : rien tant que les ventes sont trop faibles, puis les 3 pizzas les plus commandées', async () => {
  const ctx = await setup();
  await ctx.place([{ itemId: 2, quantity: 4 }]);
  assert.deepEqual((await ctx.get('/api/menu')).bestSellers, []); // 4 pizzas : trop peu pour parler de best-seller

  const ctx2 = await setup();
  await ctx2.place([{ itemId: 2, quantity: 6 }, { itemId: 7, quantity: 9 }]); // les boissons ne comptent pas
  await ctx2.place([{ itemId: 1, quantity: 3 }, { itemId: 4, quantity: 2 }, { itemId: 6, quantity: 1 }]);
  const menu = await ctx2.get('/api/menu');
  assert.deepEqual(menu.bestSellers, [2, 1, 4]); // Diavola (1 seule vente) exclue
  ctx2.clock.advanceDays(40); // hors fenêtre de 30 jours
  ctx2.clock.advanceMinutes(10);
  assert.deepEqual((await ctx2.get('/api/menu')).bestSellers, []);
});

test('base créée avant les avis : migration automatique sans perte', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'li-')), 'old.db');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE orders (id TEXT PRIMARY KEY, number INTEGER NOT NULL, customer_name TEXT NOT NULL, phone TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '', pickup_date TEXT NOT NULL, pickup_time TEXT NOT NULL, payment_method TEXT NOT NULL,
    payment_status TEXT NOT NULL, status TEXT NOT NULL, total_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL DEFAULT 0,
    pizza_count INTEGER NOT NULL DEFAULT 0, loyalty_id TEXT, reward_used INTEGER NOT NULL DEFAULT 0,
    stamps_credited INTEGER NOT NULL DEFAULT 0, push_token TEXT, stripe_payment_intent TEXT, created_at TEXT NOT NULL);
    INSERT INTO orders (id, number, customer_name, phone, pickup_date, pickup_time, payment_method, payment_status, status, total_cents, created_at)
    VALUES ('x', 1, 'Ancien', '0600000000', '2026-01-01', '12:00', 'on_pickup', 'unpaid', 'done', 1150, '2026-01-01T10:00:00Z');`);
  old.close();
  const db = openDb(path);
  assert.ok(db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'feedback'));
  assert.equal(db.prepare('SELECT customer_name FROM orders').get().customer_name, 'Ancien');
  db.prepare("UPDATE orders SET feedback = 'ok' WHERE id = 'x'").run();
  openDb(path); // réouverture : idempotent
});
