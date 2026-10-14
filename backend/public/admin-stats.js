/* Écrans « Stats » et « Clients » de l'admin. Graphiques en SVG/HTML pur (aucune bibliothèque, fonctionne hors ligne).
   Utilise les helpers de admin.html : $, api, esc, euro, safe. */

const fr = (n, d = 0) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x) => `${fr(x * 100)} %`;
const compactEuro = (cents) => (cents >= 100000 ? `${fr(cents / 100000, 1)} k€` : `${fr(cents / 100)} €`);
const dayLabel = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const dayLong = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const WEEK = [1, 2, 3, 4, 5, 6, 0]; // lundi en premier
const WEEKDAY = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

/* ---------- Mini bibliothèque de graphiques ---------- */

// Plafond d'axe « rond » (1, 2, 2,5, 5 × 10^k) pour des graduations lisibles.
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

// Graphique en colonnes : une seule mesure, une seule couleur, valeur affichée sur le pic uniquement.
// Colonnes fines (24 px max) arrondies en haut, sur une même ligne de base ; infobulle au survol/toucher.
function chartWidth(halfWidth) {
  const avail = ($('#stats')?.clientWidth ?? 640) - 30; // largeur utile d'une carte
  const w = halfWidth && avail >= 620 ? (avail - 12) / 2 : avail;
  return Math.round(Math.max(280, Math.min(720, w)));
}

function columnChart({ data, value, tickLabel, tip, fmtAxis, fmtPeak, title, color = 'var(--chart-main)', height = 190, minMax = 1, half = false }) {
  const W = chartWidth(half), ML = 44, MR = 8, MT = 22, MB = 26;
  const H = height, innerW = W - ML - MR, innerH = H - MT - MB;
  const max = niceMax(Math.max(minMax, ...data.map(value)));
  const band = innerW / data.length;
  const bw = Math.min(24, band * 0.7);
  const y = (v) => MT + innerH - (v / max) * innerH;
  const peakIdx = data.some((d) => value(d) > 0) ? data.reduce((b, d, i) => (value(d) > value(data[b]) ? i : b), 0) : -1;
  const every = Math.ceil(data.length / Math.max(2, Math.floor(innerW / 48)));

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" class="chart">`;
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, yy = y(v);
    svg += `<line x1="${ML}" x2="${W - MR}" y1="${yy}" y2="${yy}" stroke="var(--grid)" stroke-width="1"/>`;
    svg += `<text x="${ML - 6}" y="${yy + 4}" text-anchor="end" class="axis">${fmtAxis(v)}</text>`;
  }
  data.forEach((d, i) => {
    const v = value(d), cx = ML + band * i + band / 2, h = (v / max) * innerH, top = MT + innerH - h;
    if (v > 0) {
      const r = Math.min(4, h, bw / 2), x = cx - bw / 2;
      svg += `<path d="M${x},${MT + innerH} V${top + r} a${r},${r} 0 0 1 ${r},${-r} H${x + bw - r} a${r},${r} 0 0 1 ${r},${r} V${MT + innerH} Z" fill="${color}"/>`;
    }
    if (i % every === 0) svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="axis">${esc(tickLabel(d))}</text>`;
    // zone de survol plus large que la colonne
    svg += `<rect x="${cx - band / 2}" y="${MT}" width="${band}" height="${innerH}" fill="transparent" data-tip="${esc(tip(d))}"/>`;
  });
  if (peakIdx >= 0) {
    const d = data[peakIdx], cx = ML + band * peakIdx + band / 2;
    svg += `<text x="${Math.min(Math.max(cx, ML + 16), W - 24)}" y="${y(value(d)) - 6}" text-anchor="middle" class="peak">${fmtPeak(value(d))}</text>`;
  }
  return `${svg}</svg>`;
}

// Barres horizontales (classements) : libellé, barre fine, valeur au bout.
function barList(rows) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `<div class="bars">${rows
    .map(
      (r) => `<div class="barrow" data-tip="${esc(r.tip ?? '')}">
        <div class="barlabel">${esc(r.label)}${r.sub ? `<span class="muted"> ${esc(r.sub)}</span>` : ''}</div>
        <div class="bartrack"><div class="barfill" style="width:${(r.value / max) * 100}%"></div></div>
        <div class="barvalue">${esc(r.valueText)}</div></div>`,
    )
    .join('')}</div>`;
}

// Barre scindée (2 catégories) avec légende : l'identité ne repose jamais sur la seule couleur.
function splitBar(parts) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  if (!total) return '<p class="muted">Pas encore de données.</p>';
  return `<div class="split">${parts
    .map((p) => (p.value ? `<div style="flex:${p.value};background:${p.color}" data-tip="${esc(`${p.label} : ${p.value} (${pct(p.value / total)})`)}"></div>` : ''))
    .join('')}</div>
    <div class="legend">${parts
      .map((p) => `<span><i style="background:${p.color}"></i>${esc(p.label)} <b>${fr(p.value)}</b> <span class="muted">(${pct(p.value / total)})</span></span>`)
      .join('')}</div>`;
}

const delta = (cur, prev) => {
  if (!prev) return `<span class="muted">période précédente : aucune donnée</span>`;
  const d = (cur - prev) / prev;
  if (Math.abs(d) < 0.005) return `<span class="muted">= vs période précédente</span>`;
  return `<span class="delta"><b style="color:${d > 0 ? 'var(--good)' : 'var(--warn)'}">${d > 0 ? '▲' : '▼'}</b> ${d > 0 ? '+' : '−'}${fr(Math.abs(d) * 100)} % <span class="muted">vs période précédente</span></span>`;
};
const tile = (label, value, sub) => `<div class="tile"><div class="tlabel">${label}</div><div class="tvalue">${value}</div><div class="tsub">${sub}</div></div>`;
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

// Infobulle unique pour tous les graphiques (survol souris ou toucher).
function installTooltip() {
  if (window.__tipReady) return;
  window.__tipReady = true;
  const tip = document.createElement('div');
  tip.id = 'tip'; tip.hidden = true; document.body.appendChild(tip);
  const show = (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el || !el.dataset.tip) { tip.hidden = true; return; }
    const p = e.touches ? e.touches[0] : e;
    tip.textContent = el.dataset.tip; tip.hidden = false;
    tip.style.left = Math.min(p.clientX + 12, window.innerWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top = Math.max(p.clientY - 36, 4) + 'px';
  };
  document.addEventListener('mousemove', show);
  document.addEventListener('touchstart', show, { passive: true });
  document.addEventListener('mouseleave', () => (tip.hidden = true));
}

/* ---------- Section « Cuisine » : temps de préparation, ponctualité ---------- */
function kitchenSection(k) {
  const head = `<div class="card"><h3>🔥 Cuisine : combien de temps ça prend ?</h3>
    <p class="muted">Mesuré entre vos appuis sur « Préparer » et « Prête » (${k.measured} commande${k.measured > 1 ? 's' : ''} chronométrée${k.measured > 1 ? 's' : ''}).
    Ces chiffres sont justes si l'on appuie au bon moment : « Préparer » quand on commence, « Prête » quand c'est fini.</p>`;
  if (!k.enough) {
    return `${head}<p>Pas encore assez de données (${k.measured} sur ${k.min_sample} commandes nécessaires). Utilisez « Préparer » puis « Prête » pour chaque commande : les conseils apparaîtront ici.</p></div>`;
  }
  const p = k.punctuality;
  const hours = k.by_hour.filter((h) => h.n > 0);
  const hFrom = Math.min(...hours.map((h) => h.hour)), hTo = Math.max(...hours.map((h) => h.hour));
  const byHour = k.by_hour.filter((h) => h.hour >= hFrom && h.hour <= hTo);
  const apply = [];
  if (k.suggestions.lead_minutes && k.suggestions.lead_minutes !== k.lead_minutes) {
    apply.push(`<button class="act sm" data-apply="lead" data-v="${k.suggestions.lead_minutes}">Fixer le délai minimum à ${k.suggestions.lead_minutes} min</button>`);
  }
  if (k.suggestions.capacity_per_slot && k.suggestions.capacity_per_slot !== k.max_pizzas_per_slot) {
    apply.push(`<button class="act sm" data-apply="cap" data-v="${k.suggestions.capacity_per_slot}">Limiter à ${k.suggestions.capacity_per_slot} pizzas par créneau de 15 min</button>`);
  }
  return `${head}
    <div class="tiles">
      ${tile('Temps typique', `${fr(k.prep.median, 1)} min`, '<span class="muted">de « Préparer » à « Prête »</span>')}
      ${tile('Dans 8 cas sur 10', `moins de ${fr(Math.ceil(k.prep.p80))} min`, '<span class="muted">pour une commande</span>')}
      ${tile('Prêtes à l\'heure', pct(p.on_time_share), p.late_avg_minutes ? `<span class="muted">retard moyen ${fr(p.late_avg_minutes, 1)} min</span>` : '<span class="muted">aucun retard notable</span>')}
      ${tile('Attente au comptoir', k.counter_wait.median === null ? '—' : `${fr(k.counter_wait.median, 1)} min`, '<span class="muted">entre « Prête » et « Retirée »</span>')}
    </div>
    <div class="grid2">
      <div><h3 style="margin-top:8px">Selon le nombre de pizzas</h3><p class="muted">Temps de préparation typique d'une commande</p>
        ${columnChart({
          data: k.by_pizzas, value: (g) => g.median ?? 0, title: 'Temps de préparation selon le nombre de pizzas', height: 170, half: true, minMax: 10,
          tickLabel: (g) => `${g.label}`, fmtAxis: (v) => `${fr(v)} min`, fmtPeak: (v) => `${fr(v, 1)} min`,
          tip: (g) => (g.median === null ? `${g.label} pizza(s) : pas assez de données (${g.n})` : `${g.label} pizza(s) : ${fr(g.median, 1)} min (${g.n} commandes)`),
        })}</div>
      <div><h3 style="margin-top:8px">Selon l'heure</h3><p class="muted">Temps de préparation typique, par heure de retrait</p>
        ${columnChart({
          data: byHour, value: (h) => h.median ?? 0, title: 'Temps de préparation selon l\'heure de retrait', height: 170, half: true, minMax: 10,
          tickLabel: (h) => `${h.hour} h`, fmtAxis: (v) => `${fr(v)} min`, fmtPeak: (v) => `${fr(v, 1)} min`,
          tip: (h) => (h.median === null ? `${h.hour} h : pas assez de données (${h.n})` : `${h.hour} h–${h.hour + 1} h : ${fr(h.median, 1)} min (${h.n} commandes)`),
        })}</div>
    </div>
    <h3 style="margin-top:14px">Ce que ça nous apprend</h3>
    <ul class="insights">${k.insights.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    ${apply.length ? `<div class="row" style="margin-top:8px">${apply.join('')}</div>` : ''}
    </div>`;
}

/* ---------- Écran « Stats » ---------- */

let statsDays = 30;

let lastStats = null, lastForecast = null;
async function loadStats() {
  installTooltip();
  [lastStats, lastForecast] = await Promise.all([api(`/stats?days=${statsDays}`), api('/forecast').catch(() => null)]);
  renderStats();
}

// Prévision : combien de pizzas attendre dans les 3 prochains jours, et donc de pâtons à prévoir.
function forecastCard(fc) {
  if (!fc) return '';
  const label = (d, i) => (i === 0 ? "Aujourd'hui" : i === 1 ? 'Demain' : '') + ` ${WEEKDAY[d.weekday]}`;
  const rows = fc.days.map((d, i) => {
    if (!d.open) return `<tr><td>${label(d, i)}</td><td colspan="3" class="muted">Fermé</td></tr>`;
    const exp = d.reliable ? `≈ ${fr(d.expected_pizzas, 0)} pizzas (${fr(d.expected_orders, 0)} commandes)` : '<span class="muted">pas assez d\'historique</span>';
    return `<tr><td><b>${label(d, i)}</b></td><td>${exp}</td><td>${d.booked_pizzas ? `${d.booked_pizzas} déjà réservée${d.booked_pizzas > 1 ? 's' : ''}` : '<span class="muted">—</span>'}</td><td><b>${d.suggested_doughs}</b> pâtons</td></tr>`;
  }).join('');
  return `<div class="card"><h3>📦 À prévoir en cuisine</h3>
    <p class="muted">D'après les mêmes jours des dernières semaines, plus 10 % de marge (jamais moins que ce qui est déjà réservé). Indicatif.</p>
    <table class="tbl"><tr><th>Jour</th><th>Attendu</th><th>Précommandes</th><th>À prévoir</th></tr>${rows}</table></div>`;
}
let lastWidth = 0;
window.addEventListener('resize', () => {
  const w = $('#stats')?.clientWidth ?? 0;
  if (lastStats && w && Math.abs(w - lastWidth) > 20 && !$('#stats').hidden) renderStats();
});

function renderStats() {
  const s = lastStats;
  lastWidth = $('#stats').clientWidth;
  const t = s.totals, p = s.previous;
  const periodChips = [7, 30, 90].map((d) => `<button class="chip ${d === statsDays ? 'on' : ''}" data-days="${d}">${d} jours</button>`).join('');

  const hours = s.hourly.filter((h) => h.orders > 0);
  const hFrom = hours.length ? Math.max(Math.min(...hours.map((h) => h.hour)) - 1, 0) : 10;
  const hTo = hours.length ? Math.min(Math.max(...hours.map((h) => h.hour)) + 1, 23) : 21;
  const hourly = s.hourly.filter((h) => h.hour >= hFrom && h.hour <= hTo);
  const week = WEEK.map((w) => s.weekday[w]);

  const ranked = s.topItems.filter((i) => i.units > 0);
  const rated = s.topItems.filter((i) => i.rating_count >= 3);
  const empty = t.orders === 0;

  $('#stats').innerHTML = `
    <div class="card today">
      <b>Aujourd'hui</b> — ${s.today.orders} commande${s.today.orders > 1 ? 's' : ''} · ${euro(s.today.revenue_cents)} · ${fr(s.today.pizzas)} pizza${s.today.pizzas > 1 ? 's' : ''}
      ${s.today.in_progress ? `· <span class="badge preparing">${s.today.in_progress} en cours</span>` : ''}
    </div>
    ${forecastCard(lastForecast)}
    <div class="row" style="margin:12px 0">${periodChips}<span class="muted grow" style="text-align:right">${dayLabel(s.range.from)} → ${dayLabel(s.range.to)}</span></div>
    ${empty ? '<div class="card muted">Pas encore de commande sur cette période. Les graphiques se rempliront au fil des commandes.</div>' : ''}
    <div class="tiles">
      ${tile("Chiffre d'affaires", euro(t.revenue_cents), delta(t.revenue_cents, p.revenue_cents))}
      ${tile('Commandes', fr(t.orders), delta(t.orders, p.orders))}
      ${tile('Panier moyen', euro(t.avg_basket_cents), delta(t.avg_basket_cents, p.avg_basket_cents))}
      ${tile('Pizzas vendues', fr(t.pizzas), delta(t.pizzas, p.pizzas))}
    </div>

    <div class="card"><h3>Chiffre d'affaires par jour</h3>
      ${columnChart({
        data: s.daily, value: (d) => d.revenue_cents, title: "Chiffre d'affaires par jour",
        tickLabel: (d) => dayLabel(d.date), fmtAxis: compactEuro, fmtPeak: (v) => euro(v),
        tip: (d) => `${dayLong(d.date)} : ${euro(d.revenue_cents)} · ${d.orders} commande${d.orders > 1 ? 's' : ''}`, minMax: 1000,
      })}
      <details><summary>Voir les chiffres</summary>
        <table class="tbl"><tr><th>Jour</th><th>Commandes</th><th>CA</th></tr>
        ${s.daily.slice().reverse().map((d) => `<tr><td>${dayLong(d.date)}</td><td>${d.orders}</td><td>${euro(d.revenue_cents)}</td></tr>`).join('')}</table></details>
    </div>

    <div class="grid2">
      <div class="card"><h3>Heures de pointe</h3><p class="muted">Commandes selon l'heure de retrait</p>
        ${columnChart({
          data: hourly, value: (h) => h.orders, title: 'Commandes par heure de retrait', height: 170,
          half: true, tickLabel: (h) => `${h.hour} h`, fmtAxis: (v) => fr(v, v % 1 ? 1 : 0), fmtPeak: (v) => `${v}`,
          tip: (h) => `${h.hour} h – ${h.hour + 1} h : ${h.orders} commande${h.orders > 1 ? 's' : ''}`, minMax: 4,
        })}</div>
      <div class="card"><h3>Jours les plus chargés</h3><p class="muted">Commandes par jour, en moyenne</p>
        ${columnChart({
          data: week, value: (w) => w.avg_orders, title: 'Commandes moyennes par jour de la semaine', height: 170,
          half: true, tickLabel: (w) => WEEKDAY[w.weekday], fmtAxis: (v) => fr(v, v % 1 ? 1 : 0), fmtPeak: (v) => fr(v, 1),
          tip: (w) => `${WEEKDAY[w.weekday]} : ${fr(w.avg_orders, 1)} commandes en moyenne (${w.orders} sur ${w.days} jour${w.days > 1 ? 's' : ''})`, minMax: 4,
        })}</div>
    </div>

    <div class="card"><h3>Ce qui se vend</h3>
      <p class="muted">Quantités vendues sur la période. Une moitié-moitié compte ½ pour chaque pizza ; les articles d'une formule comptent chacun 1.</p>
      ${ranked.length ? barList(ranked.map((i) => ({
        label: i.name, sub: i.rating_count >= 3 ? `★ ${fr(i.rating_avg, 1)} (${i.rating_count})` : '',
        value: i.units, valueText: fr(i.units, i.units % 1 ? 1 : 0),
        tip: `${i.name} : ${fr(i.units, i.units % 1 ? 1 : 0)} vendue(s)${i.revenue_cents ? ` · ${euro(i.revenue_cents)} hors formules` : ''}`,
      }))) : '<p class="muted">Pas encore de ventes.</p>'}
    </div>

    ${kitchenSection(s.kitchen)}

    <div class="grid2">
      <div class="card"><h3>Clients</h3>
        ${splitBar([
          { label: 'Nouveaux', value: s.customers.new, color: 'var(--series-1)' },
          { label: 'Déjà clients', value: s.customers.returning, color: 'var(--series-2)' },
        ])}
        <p class="muted" style="margin-top:10px">${fr(s.customers.total)} client${s.customers.total > 1 ? 's' : ''} au total · ${pct(s.customers.repeat_rate)} ont commandé au moins 2 fois.
        Fidélité : ${fr(s.loyalty.members)} client${s.loyalty.members > 1 ? 's' : ''} avec des tampons, ${fr(s.loyalty.rewards_redeemed)} pizza${s.loyalty.rewards_redeemed > 1 ? 's' : ''} offerte${s.loyalty.rewards_redeemed > 1 ? 's' : ''} utilisée${s.loyalty.rewards_redeemed > 1 ? 's' : ''}.</p></div>
      <div class="card"><h3>Paiement</h3>
        ${splitBar([
          { label: 'En ligne', value: Math.round(t.online_share * t.orders), color: 'var(--series-1)' },
          { label: 'Au retrait', value: t.orders - Math.round(t.online_share * t.orders), color: 'var(--series-2)' },
        ])}
        ${t.discount_cents ? `<p class="muted" style="margin-top:10px">Pizzas offertes (fidélité) sur la période : ${euro(t.discount_cents)}.</p>` : ''}</div>
    </div>

    <div class="card"><h3>Avis clients</h3>
      ${s.ratings.count
        ? `<p><b class="big">★ ${fr(s.ratings.average, 1)}</b> <span class="muted">sur 5 · ${s.ratings.count} note${s.ratings.count > 1 ? 's' : ''}</span></p>
           ${rated.length ? `<p class="muted">Mieux notées : ${rated.slice().sort((a, b) => b.rating_avg - a.rating_avg).slice(0, 3).map((i) => `${esc(i.name)} (${fr(i.rating_avg, 1)})`).join(' · ')}</p>` : ''}
           ${s.ratings.recent.length ? s.ratings.recent.map((r) => `<div class="review"><div class="muted">${[esc(r.first_name), dayLabel(r.date), ...r.ratings.map((x) => `${esc(x.name)} ${stars(x.rating)}`)].join(' · ')}</div>« ${esc(r.comment)} »</div>`).join('') : ''}`
        : '<p class="muted">Pas encore d\'avis. Les clients peuvent noter leurs pizzas dans l\'appli après le retrait de leur commande.</p>'}
    </div>`;

  $('#stats').querySelectorAll('[data-apply]').forEach((b) => (b.onclick = safe(async () => {
    const body = b.dataset.apply === 'lead' ? { leadMinutes: Number(b.dataset.v) } : { maxPizzasPerSlot: Number(b.dataset.v) };
    await api('/settings', { method: 'PUT', body });
    await loadStats();
  })));
  $('#stats').querySelectorAll('[data-days]').forEach((b) => (b.onclick = safe(async () => { statsDays = Number(b.dataset.days); await loadStats(); })));
}

/* ---------- Écran « Clients » (petit CRM) ---------- */

const SEGMENTS = {
  all: 'Tous', regular: 'Fidèles (3 commandes et +)', new: 'Nouveaux (30 j)', dormant: 'À relancer (inactifs > 30 j)', occasional: 'Occasionnels',
};
let crm = { list: [], segment: 'all', sort: 'spent', q: '' };

async function loadClients() {
  crm.list = (await api('/customers')).customers;
  $('#clients').innerHTML = '<div id="campaignBox"></div><div id="clientList"></div>';
  renderClients();
  renderCampaigns().catch(() => {});
}

function renderClients() {
  const counts = Object.fromEntries(Object.keys(SEGMENTS).map((k) => [k, k === 'all' ? crm.list.length : crm.list.filter((c) => c.segment === k).length]));
  const sorters = {
    spent: (a, b) => b.spent_cents - a.spent_cents,
    orders: (a, b) => b.orders - a.orders,
    recent: (a, b) => a.days_since_last - b.days_since_last,
    name: (a, b) => a.name.localeCompare(b.name, 'fr'),
  };
  const q = crm.q.trim().toLowerCase();
  const rows = crm.list
    .filter((c) => (crm.segment === 'all' || c.segment === crm.segment) && (!q || c.name.toLowerCase().includes(q) || c.phone.includes(q.replace(/\s/g, ''))))
    .sort(sorters[crm.sort]);

  $('#clientList').innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <input id="cq" class="grow" placeholder="Rechercher un nom ou un numéro" value="${esc(crm.q)}">
      <select id="csort">${[['spent', 'Les plus dépensiers'], ['orders', 'Le plus de commandes'], ['recent', 'Commande la plus récente'], ['name', 'Nom (A→Z)']].map(([k, v]) => `<option value="${k}" ${k === crm.sort ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <button class="act sm" id="cexport">Exporter (CSV)</button>
    </div>
    <div class="row" style="margin-bottom:12px">${Object.entries(SEGMENTS).map(([k, v]) => `<button class="chip ${k === crm.segment ? 'on' : ''}" data-seg="${k}">${v} <b>${counts[k]}</b></button>`).join('')}</div>
    ${rows.length ? rows.map(clientCard).join('') : `<div class="card muted">${crm.list.length ? 'Aucun client ne correspond.' : 'Pas encore de client. Ils apparaissent ici dès la première commande.'}</div>`}
    <p class="muted">Ces données servent à gérer les commandes. Pour envoyer des offres ou des SMS promotionnels, il faut l'accord préalable du client.</p>`;

  $('#cq').oninput = (e) => { crm.q = e.target.value; const pos = e.target.selectionStart; renderClients(); const i = $('#cq'); i.focus(); i.setSelectionRange(pos, pos); };
  $('#csort').onchange = (e) => { crm.sort = e.target.value; renderClients(); };
  $('#cexport').onclick = exportCsv;
  $('#clients').querySelectorAll('[data-seg]').forEach((b) => (b.onclick = () => { crm.segment = b.dataset.seg; renderClients(); }));
  $('#clients').querySelectorAll('[data-client] summary').forEach((sm) => (sm.onclick = () => { const d = sm.parentElement; if (!d.dataset.loaded) openClient(d); }));
}

const SEG_BADGE = { regular: ['Fidèle', 'ready'], new: ['Nouveau', 'new'], dormant: ['À relancer', 'preparing'], occasional: ['', ''] };
function clientCard(c) {
  const [label, cls] = SEG_BADGE[c.segment];
  const ago = c.days_since_last === 0 ? "aujourd'hui" : c.days_since_last === 1 ? 'hier' : `il y a ${c.days_since_last} jours`;
  return `<details class="card client" data-client="${esc(c.phone)}">
    <summary class="row"><b class="grow">${esc(c.name)} ${label ? `<span class="badge ${cls}">${label}</span>` : ''}${c.note ? ' 📝' : ''}</b>
      <span>${c.orders} commande${c.orders > 1 ? 's' : ''} · <b>${euro(c.spent_cents)}</b></span></summary>
    <div class="muted" style="margin-top:6px">Dernière commande ${ago}${c.favorite ? ` · pizza préférée : ${esc(c.favorite)}` : ''} · panier moyen ${euro(c.avg_basket_cents)}</div>
    <div class="detail">Chargement…</div></details>`;
}

async function openClient(el) {
  el.dataset.loaded = '1';
  const phone = el.dataset.client;
  const d = await api(`/customers/${phone}`);
  el.querySelector('.detail').innerHTML = `
    <p><a href="tel:${esc(phone)}">📞 ${esc(phone)}</a> · client depuis le ${d.first_date.split('-').reverse().join('/')}</p>
    ${d.favorites.length ? `<p class="muted">Ses pizzas : ${d.favorites.map((f) => `${esc(f.name)} (${fr(f.units, f.units % 1 ? 1 : 0)})`).join(', ')}</p>` : ''}
    <label class="f">Note privée (allergies, habitudes…)<textarea rows="2" data-note maxlength="500">${esc(d.note)}</textarea></label>
    <p class="row"><button class="act sm" data-savenote>Enregistrer la note</button><span class="saved" data-ok></span></p>
    <table class="tbl"><tr><th>Date</th><th>Commande</th><th>Total</th></tr>
      ${d.orders.map((o) => `<tr><td>${dayLabel(o.pickup_date)} ${o.pickup_time}</td><td>${o.items.map((i) => `${i.quantity}× ${esc(i.name)}${i.details ? ` <span class="muted">(${esc(i.details)})</span>` : ''}`).join(', ')}</td><td>${euro(o.total_cents)}</td></tr>`).join('')}</table>`;
  el.querySelector('[data-savenote]').onclick = safe(async () => {
    const note = el.querySelector('[data-note]').value;
    await api(`/customers/${phone}/note`, { method: 'PUT', body: { note } });
    crm.list.find((c) => c.phone === phone).note = note;
    el.querySelector('[data-ok]').textContent = '✓ Enregistré';
  });
}

function exportCsv() {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Nom', 'Téléphone', 'Commandes', 'Dépensé (€)', 'Dernière commande', 'Pizza préférée', 'Statut', 'Note']].concat(
    crm.list.map((c) => [c.name, c.phone, c.orders, (c.spent_cents / 100).toFixed(2).replace('.', ','), c.last_date, c.favorite ?? '', SEGMENTS[c.segment] ?? '', c.note]),
  );
  const blob = new Blob(['﻿' + lines.map((l) => l.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `clients-little-italy-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  URL.revokeObjectURL(a.href);
}
