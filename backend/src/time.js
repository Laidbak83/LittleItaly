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
export function availableSlots(config, now = new Date()) {
  const local = localNow(config.timezone, now);
  if (config.closedWeekdays.includes(local.weekday)) return { date: local.date, slots: [] };
  const earliest = local.minutes + config.leadMinutes;
  const slots = [];
  for (const [open, close] of config.hours) {
    for (let t = toMinutes(open); t <= toMinutes(close); t += config.slotMinutes) {
      if (t >= earliest) slots.push(toHHMM(t));
    }
  }
  return { date: local.date, slots };
}
