// Heure locale du restaurant (Europe/Paris), sans dépendance externe.
export function localNow(timezone, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: weekdays.indexOf(parts.weekday),
  };
}

export const addDays = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);

// Instant (Date) correspondant à une date et une heure LOCALES du restaurant, changements d'heure compris.
export function localToDate(timezone, date, hhmm) {
  const [y, m, d] = date.split('-').map(Number);
  const [H, M] = hhmm.split(':').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, H, M);
  const offsetAt = (ms) => {
    const l = localNow(timezone, new Date(ms));
    const [ly, lm, ld] = l.date.split('-').map(Number);
    return Date.UTC(ly, lm - 1, ld, 0, l.minutes) - Math.floor(ms / 60000) * 60000;
  };
  const first = asUtc - offsetAt(asUtc);
  return new Date(asUtc - offsetAt(first));
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Créneaux de retrait encore disponibles aujourd'hui.
// opts : extraLeadMinutes (mode rush), maxPerSlot (capacité du four, 0 = illimité),
// booked (Map heure → pizzas déjà réservées), pizzas (pizzas de la commande en cours).
export function availableSlots(config, now = new Date(), opts = {}) {
  const { extraLeadMinutes = 0, leadMinutes = config.leadMinutes, maxPerSlot = 0, booked = new Map(), pizzas = 1 } = opts;
  const local = localNow(config.timezone, now);
  const earliest = local.minutes + leadMinutes + extraLeadMinutes;
  const slots = [];
  for (const [open, close] of config.hoursByWeekday[local.weekday] ?? []) {
    for (let t = toMinutes(open); t <= toMinutes(close); t += config.slotMinutes) {
      const hhmm = toHHMM(t);
      if (t < earliest) continue;
      if (maxPerSlot && (booked.get(hhmm) ?? 0) + Math.max(pizzas, 1) > maxPerSlot) continue;
      slots.push(hhmm);
    }
  }
  return { date: local.date, slots };
}
