import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { computeKitchen, median, typicalPrepMinutes } from '../src/kitchen.js';
import { localToDate } from '../src/time.js';

const config = loadConfig({});
const NOW = new Date('2026-10-14T16:00:00Z'); // mercredi 18:00 à Paris
const TODAY = '2026-10-14';
let seq = 0;

const freshDb = () => openDb(':memory:', { seed: false });
// Insère une commande déjà chronométrée : la préparation démarre `startBefore` min avant l'heure de retrait.
function timed(db, { pickup = '12:30', pizzas = 1, startBefore = 15, prep, wait = 4, status = 'done', date = TODAY }) {
  const at = localToDate(config.timezone, date, pickup).getTime();
  const start = at - startBefore * 60000;
  const ready = start + prep * 60000;
  db.prepare(`INSERT INTO orders (id, number, customer_name, phone, pickup_date, pickup_time, payment_method, payment_status,
    status, total_cents, pizza_count, created_at, preparing_at, ready_at, done_at)
    VALUES (?,?,?,?,?,?,'on_pickup','unpaid',?,1150,?,?,?,?,?)`).run(
    `k${++seq}`, seq, 'Client', '0600000000', date, pickup, status, pizzas, new Date(start - 3600000).toISOString(),
    new Date(start).toISOString(), new Date(ready).toISOString(), wait === null ? null : new Date(ready + wait * 60000).toISOString(),
  );
}

test('médiane', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('temps par nombre de pizzas, temps par pizza supplémentaire, délai et capacité conseillés', () => {
  const db = freshDb();
  for (let i = 0; i < 20; i++) {
    const k = (i % 4) + 1;
    timed(db, { pizzas: k, prep: 6 + 2.5 * k }); // 8,5 / 11 / 13,5 / 16 min, prête à l'heure
  }
  const k = computeKitchen(db, config, NOW, 7);
  assert.equal(k.measured, 20);
  assert.equal(k.enough, true);
  assert.deepEqual(k.by_pizzas.map((g) => g.median), [8.5, 11, 13.5, 16]);
  assert.deepEqual(k.by_pizzas.map((g) => g.n), [5, 5, 5, 5]);
  assert.deepEqual([k.prep.median, k.prep.p80], [12.3, 16]);
  assert.equal(k.per_pizza_minutes, 2.5);
  assert.deepEqual(k.suggestions, { lead_minutes: 20, capacity_per_slot: 6 }); // 15 min / 2,5 min par pizza
  assert.equal(k.punctuality.on_time_share, 1);
  assert.equal(k.counter_wait.median, 4);
  assert.ok(k.insights.some((t) => t.includes('correspond bien')));
  assert.ok(k.insights.some((t) => t.includes('2,5 min')));
  assert.ok(k.insights.some((t) => t.includes('100 %')));
  assert.equal(typicalPrepMinutes(db, config, NOW), 12.25);
});

test('retards, heure la plus lente, attente au comptoir : conseils chiffrés', () => {
  const db = freshDb();
  for (let i = 0; i < 12; i++) timed(db, { pickup: '12:15', prep: 8, startBefore: 12, wait: 12 }); // calme : prête 4 min en avance
  for (let i = 0; i < 6; i++) timed(db, { pickup: '19:30', prep: 15, startBefore: 5, wait: 12 }); // coup de feu : 10 min de retard
  const k = computeKitchen(db, config, NOW, 7);
  assert.equal(k.punctuality.late_share, 6 / 18);
  assert.equal(k.punctuality.late_avg_minutes, 10);
  assert.equal(k.punctuality.early_avg_minutes, 4);
  assert.equal(k.per_pizza_minutes, null); // que des commandes d'1 pizza : pas de pente
  assert.equal(k.suggestions.capacity_per_slot, null);
  const hour = (h) => k.by_hour.find((x) => x.hour === h).median;
  assert.deepEqual([hour(12), hour(19)], [8, 15]);
  const text = k.insights.join('\n');
  assert.match(text, /33 % des commandes sont prêtes en retard/);
  assert.match(text, /19 h–20 h.*15 min contre 8 min/);
  assert.match(text, /attend 12 min au comptoir/);
  assert.match(text, /retraits plus tôt.*15 min.*délai minimum est de 20 min/); // p80 = 15 min
});

test('pas assez de données : aucune conclusion ; valeurs aberrantes et commandes non chronométrées écartées', () => {
  const db = freshDb();
  for (let i = 0; i < 5; i++) timed(db, { prep: 10 });
  timed(db, { prep: 120 }); // oubli d'appuyer sur « Prête » : écartée
  db.prepare("UPDATE orders SET preparing_at = NULL WHERE rowid = 1").run(); // jamais passée par « Préparer »
  const k = computeKitchen(db, config, NOW, 7);
  assert.equal(k.measured, 4);
  assert.equal(k.enough, false);
  assert.deepEqual(k.insights, []);
  assert.deepEqual(k.suggestions, { lead_minutes: null, capacity_per_slot: null });
  assert.equal(typicalPrepMinutes(db, config, NOW), null);
});

test('période : seules les commandes de la fenêtre comptent', () => {
  const db = freshDb();
  for (let i = 0; i < 10; i++) timed(db, { prep: 10 });
  for (let i = 0; i < 10; i++) timed(db, { prep: 30, date: '2026-09-01' }); // il y a plus d'un mois
  assert.equal(computeKitchen(db, config, NOW, 7).measured, 10);
  assert.equal(computeKitchen(db, config, NOW, 90).measured, 20);
});

test('heure locale → instant : été, hiver et jour du changement d\'heure', () => {
  const at = (d, h) => localToDate('Europe/Paris', d, h).toISOString();
  assert.equal(at('2026-10-14', '12:30'), '2026-10-14T10:30:00.000Z'); // UTC+2
  assert.equal(at('2026-12-14', '12:30'), '2026-12-14T11:30:00.000Z'); // UTC+1
  assert.equal(at('2026-10-25', '12:30'), '2026-10-25T11:30:00.000Z'); // jour du passage à l'heure d'hiver
  assert.equal(at('2026-10-25', '01:30'), '2026-10-24T23:30:00.000Z'); // encore UTC+2
});
