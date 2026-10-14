import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { availableSlots } from '../src/time.js';

// Vérifie la VRAIE carte (src/seed.js) : tarif unique emporté, suppléments, Pizza Duo, horaires.
const config = { ...loadConfig({ ADMIN_TOKEN: 'secret' }), dbPath: ':memory:' };
const NOW = new Date('2026-10-14T10:00:00Z'); // mercredi 12:00 à Paris

async function setup() {
  const app = await buildApp({ db: openDb(':memory:'), config, now: () => NOW });
  await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { authorization: 'Bearer secret' }, payload: { maxPizzasPerSlot: 0 } });
  const menu = (await app.inject({ url: '/api/menu' })).json();
  return { app, menu };
}
const order = (items) => ({
  customerName: 'Marie', phone: '0612345678', pickupTime: '18:00', paymentMethod: 'on_pickup', items,
});

test('toutes les pizzas à emporter sont à 11,50 € et les noms de la carte sont là', async () => {
  const { menu } = await setup();
  const pizzas = menu.items.filter((i) => i.kind === 'pizza');
  assert.equal(pizzas.length, 11);
  assert.ok(pizzas.every((p) => p.price_cents === 1150 && p.sizes.length === 0));
  assert.deepEqual(
    pizzas.map((p) => p.name),
    ['Pacino', 'Berges', 'Scorcese', 'De Palma', 'Tarentino', 'Pesci', 'Phoenix', 'Fraticelli', 'Pop Toys', "Soprano's", 'Calzone'],
  );
  const pacino = pizzas[0];
  assert.deepEqual(pacino.ingredients, ['Tomate', 'Fromage', 'Olives', 'Herbes']);
  assert.equal(pizzas.at(-1).ingredients[0], 'Tomate'); // « Pizza en chausson : » n'est pas un ingrédient
  assert.equal(pacino.vegetarian, true);
  assert.equal(pizzas.find((p) => p.name === 'Pesci').vegetarian, false);
});

test('allergènes non renseignés (à saisir par le restaurant), plats masqués par défaut', async () => {
  const { menu } = await setup();
  assert.ok(menu.items.every((i) => i.allergens.length === 0));
  assert.ok(!menu.items.some((i) => ['Lasagne bolognaise', 'Salade César'].includes(i.name)));
  assert.equal(menu.halfAndHalf, false);
});

test('supplément = 1,00 € et boisson 3,50 €', async () => {
  const { app, menu } = await setup();
  const calzone = menu.items.find((i) => i.name === 'Calzone');
  const coca = menu.items.find((i) => i.name === 'Coca-Cola');
  const oeuf = menu.supplements.find((s) => s.name === 'Œuf');
  const res = await app.inject({
    method: 'POST', url: '/api/orders',
    payload: order([{ itemId: calzone.id, quantity: 1, extras: [oeuf.id], removed: ['Crème fraîche'] }, { itemId: coca.id, quantity: 1 }]),
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().order.total_cents, 1150 + 100 + 350);
});

test('Pizza Duo : 14 € avec la demi-pizza au choix, moitié-moitié refusé par défaut', async () => {
  const { app, menu } = await setup();
  assert.equal(menu.combos.length, 3);
  assert.ok(menu.combos.every((c) => c.price_cents === 1400 && c.slots.length === 1 && c.slots[0] === 'pizza'));
  const pop = menu.items.find((i) => i.name === 'Pop Toys');
  const res = await app.inject({ method: 'POST', url: '/api/orders', payload: order([{ comboId: menu.combos[0].id, quantity: 1, picks: [pop.id] }]) });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().order.total_cents, 1400);
  assert.equal(res.json().order.items[0].name, 'Pizza Duo · salade Chèvre');
  assert.equal(res.json().order.items[0].details, 'Pop Toys');

  const half = await app.inject({ method: 'POST', url: '/api/orders', payload: order([{ itemId: menu.items[0].id, quantity: 1, halfItemId: menu.items[1].id }]) });
  assert.equal(half.statusCode, 400);
  assert.match(half.json().error, /Moitié-moitié/);
});

test('horaires affichés : lun-mer 19h, jeu-sam 22h, dimanche 15h, jamais de pizza le dimanche soir', () => {
  const last = (iso) => availableSlots(config, new Date(iso)).slots.at(-1);
  assert.equal(last('2026-10-12T07:00:00Z'), '19:00'); // lundi
  assert.equal(last('2026-10-14T07:00:00Z'), '19:00'); // mercredi
  assert.equal(last('2026-10-15T07:00:00Z'), '22:00'); // jeudi
  assert.equal(last('2026-10-17T07:00:00Z'), '22:00'); // samedi
  assert.equal(last('2026-10-18T07:00:00Z'), '15:00'); // dimanche matin
  assert.deepEqual(availableSlots(config, new Date('2026-10-18T14:30:00Z')).slots, []); // dimanche 16h30
  assert.deepEqual(availableSlots(config, new Date('2026-10-14T18:00:00Z')).slots, []); // mercredi 20h : fermé
});
