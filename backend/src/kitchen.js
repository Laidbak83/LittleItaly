// Chronométrage de la cuisine : combien de temps prend une commande, est-elle prête à l'heure,
// combien de temps attend-elle au comptoir. Les durées viennent des appuis sur « Préparer » et « Prête » :
// elles ne valent que si la cuisine appuie au bon moment.
import { readSettings } from './settings.js';
import { addDays, localNow, localToDate } from './time.js';

const round1 = (x) => Math.round(x * 10) / 10;
const MIN_SAMPLE = 10; // en dessous, on n'affiche pas de conclusions
const ON_TIME_TOLERANCE_MIN = 2;

const sorted = (a) => [...a].sort((x, y) => x - y);
export const median = (a) => {
  if (!a.length) return null;
  const s = sorted(a), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentile = (a, p) => {
  if (!a.length) return null;
  const s = sorted(a);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

// Commandes chronométrées entre deux dates (retrait). Les valeurs aberrantes (oubli d'appuyer) sont écartées.
export function timedOrders(db, config, from, to) {
  const rows = db
    .prepare(
      `SELECT pickup_date, pickup_time, pizza_count, preparing_at, ready_at, done_at FROM orders
       WHERE status IN ('ready','done') AND preparing_at IS NOT NULL AND ready_at IS NOT NULL AND pickup_date BETWEEN ? AND ?`,
    )
    .all(from, to);
  const out = [];
  for (const r of rows) {
    const ready = Date.parse(r.ready_at);
    const prep = (ready - Date.parse(r.preparing_at)) / 60000;
    if (!(prep > 0 && prep <= 90)) continue;
    const wait = r.done_at ? (Date.parse(r.done_at) - ready) / 60000 : null;
    out.push({
      hour: Number(r.pickup_time.slice(0, 2)),
      pizzas: r.pizza_count,
      prep,
      lateBy: (ready - localToDate(config.timezone, r.pickup_date, r.pickup_time).getTime()) / 60000, // > 0 : en retard
      wait: wait !== null && wait >= 0 && wait <= 180 ? wait : null,
    });
  }
  return out;
}

// Temps de préparation typique (médiane des 30 derniers jours), ou null s'il n'y a pas assez de données.
export function typicalPrepMinutes(db, config, now, days = 30) {
  const today = localNow(config.timezone, now).date;
  const rows = timedOrders(db, config, addDays(today, -(days - 1)), today);
  return rows.length >= MIN_SAMPLE ? median(rows.map((r) => r.prep)) : null;
}

// Pente de la droite « minutes de préparation = a + b × nombre de pizzas » : b ≈ minutes par pizza en plus.
function perPizzaMinutes(rows) {
  const pts = rows.filter((r) => r.pizzas >= 1);
  const xs = new Set(pts.map((r) => Math.min(r.pizzas, 6)));
  if (pts.length < 20 || xs.size < 2) return null;
  const mx = mean(pts.map((r) => r.pizzas)), my = mean(pts.map((r) => r.prep));
  const varX = pts.reduce((s, r) => s + (r.pizzas - mx) ** 2, 0);
  if (varX === 0) return null;
  const slope = pts.reduce((s, r) => s + (r.pizzas - mx) * (r.prep - my), 0) / varX;
  return slope >= 0.3 && slope <= 15 ? round1(slope) : null;
}

export function computeKitchen(db, config, now, days) {
  const today = localNow(config.timezone, now).date;
  const rows = timedOrders(db, config, addDays(today, -(days - 1)), today);
  const settings = readSettings(db);
  const lead = settings.leadMinutes ?? config.leadMinutes;
  const n = rows.length;
  const preps = rows.map((r) => r.prep);
  const enough = n >= MIN_SAMPLE;

  const byPizzas = [1, 2, 3, 4].map((k) => {
    const g = rows.filter((r) => (k === 4 ? r.pizzas >= 4 : r.pizzas === k)).map((r) => r.prep);
    return { pizzas: k, label: k === 4 ? '4 et +' : String(k), n: g.length, median: g.length >= 3 ? round1(median(g)) : null };
  });

  const byHour = [];
  for (let h = 0; h < 24; h++) {
    const g = rows.filter((r) => r.hour === h).map((r) => r.prep);
    byHour.push({ hour: h, n: g.length, median: g.length >= 3 ? round1(median(g)) : null });
  }

  const late = rows.filter((r) => r.lateBy > ON_TIME_TOLERANCE_MIN);
  const early = rows.filter((r) => r.lateBy < -ON_TIME_TOLERANCE_MIN);
  const punctuality = {
    n,
    on_time_share: n ? (n - late.length) / n : null,
    late_share: n ? late.length / n : null,
    late_avg_minutes: late.length ? round1(mean(late.map((r) => r.lateBy))) : null,
    early_avg_minutes: early.length ? round1(mean(early.map((r) => -r.lateBy))) : null,
  };
  const waits = rows.map((r) => r.wait).filter((w) => w !== null);
  const counterWait = { n: waits.length, median: waits.length ? round1(median(waits)) : null };

  const prep = { median: n ? round1(median(preps)) : null, p80: n ? round1(percentile(preps, 0.8)) : null, avg: n ? round1(mean(preps)) : null };
  const slope = perPizzaMinutes(rows);

  const suggestions = enough
    ? {
        lead_minutes: Math.max(10, Math.ceil((prep.p80 + 2) / 5) * 5),
        capacity_per_slot: slope ? Math.min(20, Math.max(2, Math.floor(slotMinutes(config) / slope))) : null,
      }
    : { lead_minutes: null, capacity_per_slot: null };

  return {
    measured: n,
    enough,
    min_sample: MIN_SAMPLE,
    lead_minutes: lead,
    max_pizzas_per_slot: settings.maxPizzasPerSlot,
    prep,
    by_pizzas: byPizzas,
    by_hour: byHour,
    per_pizza_minutes: slope,
    punctuality,
    counter_wait: counterWait,
    suggestions,
    insights: enough ? insightsFor({ prep, lead, punctuality, counterWait, byHour, slope }) : [],
  };
}

const slotMinutes = (config) => config.slotMinutes;
const hourRange = (h) => `${h} h–${h + 1} h`;
const fr = (x) => String(x).replace('.', ',');

function insightsFor({ prep, lead, punctuality, counterWait, byHour, slope }) {
  const out = [];
  if (prep.p80 > lead) {
    out.push(`Votre délai minimum (${lead} min) est parfois trop court : 2 commandes sur 10 demandent plus de ${Math.ceil(prep.p80)} min. Augmentez-le un peu ou activez le mode « rush » aux heures chargées.`);
  } else if (prep.p80 + 5 <= lead) {
    out.push(`Vous pourriez proposer des retraits plus tôt : 8 commandes sur 10 sont prêtes en moins de ${Math.ceil(prep.p80)} min, alors que votre délai minimum est de ${lead} min.`);
  } else {
    out.push(`Votre délai minimum (${lead} min) correspond bien à la réalité : 8 commandes sur 10 sont prêtes en moins de ${Math.ceil(prep.p80)} min.`);
  }
  if (punctuality.late_share >= 0.15) {
    out.push(`${Math.round(punctuality.late_share * 100)} % des commandes sont prêtes en retard sur l'heure de retrait (de ${fr(punctuality.late_avg_minutes)} min en moyenne) : les clients attendent. Limiter le nombre de pizzas par créneau aide.`);
  } else {
    out.push(`${Math.round(punctuality.on_time_share * 100)} % des commandes sont prêtes à l'heure du retrait.`);
  }
  const hours = byHour.filter((h) => h.median !== null);
  if (hours.length >= 2) {
    const slow = hours.reduce((a, b) => (b.median > a.median ? b : a));
    const fast = hours.reduce((a, b) => (b.median < a.median ? b : a));
    if (slow.median >= fast.median * 1.4 && slow.median - fast.median >= 3) {
      out.push(`C'est entre ${hourRange(slow.hour)} que la préparation est la plus lente (${fr(slow.median)} min contre ${fr(fast.median)} min entre ${hourRange(fast.hour)}) : à ces heures, réduisez le nombre de pizzas par créneau.`);
    }
  }
  if (counterWait.n >= 5 && counterWait.median >= 8) {
    out.push(`Une commande prête attend ${fr(counterWait.median)} min au comptoir avant d'être retirée : la pizza refroidit. Les notifications de rappel aux clients aident.`);
  }
  if (slope) out.push(`Chaque pizza en plus allonge la préparation d'environ ${fr(slope)} min.`);
  return out;
}
