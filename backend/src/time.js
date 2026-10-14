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
  const { extraLeadMinutes = 0, maxPerSlot = 0, booked = new Map(), pizzas = 1 } = opts;
  const local = localNow(config.timezone, now);
  if (config.closedWeekdays.includes(local.weekday)) return { date: local.date, slots: [] };
  const earliest = local.minutes + config.leadMinutes + extraLeadMinutes;
  const slots = [];
  for (const [open, close] of config.hours) {
    for (let t = toMinutes(open); t <= toMinutes(close); t += config.slotMinutes) {
      const hhmm = toHHMM(t);
      if (t < earliest) continue;
      if (maxPerSlot && (booked.get(hhmm) ?? 0) + Math.max(pizzas, 1) > maxPerSlot) continue;
      slots.push(hhmm);
    }
  }
  return { date: local.date, slots };
}
