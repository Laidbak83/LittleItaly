// Prévision pour la cuisine : combien de pizzas attendre demain, d'après les mêmes jours de la semaine passés,
// plus ce qui est déjà précommandé. Indicatif : sert à prévoir les pâtons.
import { addDays, localNow, weekdayOf } from './time.js';

const round1 = (x) => Math.round(x * 10) / 10;
const WEEKS = 8;

export function computeForecast(db, config, now) {
  const today = localNow(config.timezone, now).date;
  const first = db.prepare("SELECT MIN(pickup_date) AS d FROM orders WHERE status NOT IN ('cancelled','pending_payment')").get().d;
  const dayTotals = db.prepare(
    "SELECT COUNT(*) AS orders, COALESCE(SUM(pizza_count),0) AS pizzas FROM orders WHERE status NOT IN ('cancelled','pending_payment') AND pickup_date = ?",
  );
  const days = [];
  for (let i = 0; i < 3; i++) {
    const date = addDays(today, i);
    const weekday = weekdayOf(date);
    const open = (config.hoursByWeekday[weekday] ?? []).length > 0;
    const samples = [];
    for (let w = 1; w <= WEEKS; w++) {
      const d = addDays(date, -7 * w);
      if (first && d >= first && d < today) samples.push(dayTotals.get(d)); // jours d'ouverture déjà vécus, même vides
    }
    const mean = (k) => (samples.length ? samples.reduce((n, s) => n + s[k], 0) / samples.length : null);
    const booked = dayTotals.get(date);
    const expectedPizzas = mean('pizzas');
    days.push({
      date,
      weekday,
      open,
      samples: samples.length,
      reliable: samples.length >= 3,
      expected_orders: expectedPizzas === null ? null : round1(mean('orders')),
      expected_pizzas: expectedPizzas === null ? null : round1(expectedPizzas),
      booked_orders: booked.orders,
      booked_pizzas: booked.pizzas,
      // +10 % de marge, et jamais moins que ce qui est déjà réservé.
      suggested_doughs: open ? Math.ceil(Math.max((expectedPizzas ?? 0) * 1.1, booked.pizzas)) : 0,
    });
  }
  return { days };
}
