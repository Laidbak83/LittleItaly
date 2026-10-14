/* Outils de l'admin : offres heures creuses, fermetures, QR codes et affiches, campagnes, ticket de cuisine.
   Utilise les helpers de admin.html et admin-stats.js : $, api, esc, euro, safe, fr. */

const parisToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); // AAAA-MM-JJ
const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const toCentsTxt = (txt) => Math.round(parseFloat(String(txt).replace(',', '.')) * 100);
const WEEK_ORDER = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];
const DAY_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

/* ---------- Offres heures creuses ---------- */
async function renderOffers() {
  const el = $('#offersCard'); if (!el) return;
  const { offers } = await api('/offers');
  const days = (csv) => (csv === '' ? 'tous les jours' : csv.split(',').map((d) => DAY_SHORT[Number(d)]).join(' '));
  el.innerHTML = `<div class="card"><b>🕑 Offres heures creuses</b>
    <div class="muted">Une remise sur les retraits aux heures calmes (voir « Heures de pointe » dans Stats) : elle lisse la charge du four. Le client voit l'offre sur le créneau.</div>
    ${offers.length ? offers.map((o) => `<div class="row offer ${o.active ? '' : 'off'}" data-offer="${o.id}" style="margin-top:8px">
        <span class="grow"><b>${esc(o.label)}</b> · ${o.start_time}–${o.end_time} · ${days(o.weekdays)} · <b>−${euro(o.discount_cents)}</b>${o.min_order_cents ? ` dès ${euro(o.min_order_cents)}` : ''}</span>
        <button class="act sm" data-toggle>${o.active ? 'Active' : 'En pause'}</button><button class="act red sm" data-del>Supprimer</button></div>`).join('') : '<p class="muted">Aucune offre pour le moment.</p>'}
    <h4 style="margin:14px 0 4px">Nouvelle offre</h4>
    <div class="row"><input id="oLabel" placeholder="Nom (ex : Goûter)" maxlength="40" class="grow">
      <label class="f" style="margin:0">De <input id="oFrom" type="time" value="14:00"></label><label class="f" style="margin:0">à <input id="oTo" type="time" value="18:00"></label></div>
    <div class="row" style="margin-top:8px">${WEEK_ORDER.map(([n, l]) => `<label class="chip"><input type="checkbox" class="oDay" value="${n}"> ${l}</label>`).join('')}<span class="muted">(aucun jour coché = tous les jours)</span></div>
    <div class="row" style="margin-top:8px"><label class="f" style="margin:0">Remise € <input id="oDisc" size="5" inputmode="decimal" placeholder="1,00"></label>
      <label class="f" style="margin:0">Commande minimum € <input id="oMin" size="5" inputmode="decimal" placeholder="0"></label>
      <button class="act" id="oAdd">Ajouter</button></div></div>`;
  el.querySelectorAll('[data-offer]').forEach((row) => {
    const id = row.dataset.offer, o = offers.find((x) => x.id == id);
    row.querySelector('[data-toggle]').onclick = safe(async () => { await api(`/offers/${id}`, { method: 'PATCH', body: { active: !o.active } }); renderOffers(); });
    row.querySelector('[data-del]').onclick = safe(async () => { if (confirm('Supprimer cette offre ?')) { await api(`/offers/${id}`, { method: 'DELETE' }); renderOffers(); } });
  });
  $('#oAdd').onclick = safe(async () => {
    const discountCents = toCentsTxt($('#oDisc').value), minOrderCents = $('#oMin').value.trim() ? toCentsTxt($('#oMin').value) : 0;
    if (isNaN(discountCents) || isNaN(minOrderCents)) return alert('Remise ou minimum invalide');
    await api('/offers', { method: 'POST', body: {
      label: $('#oLabel').value, startTime: $('#oFrom').value, endTime: $('#oTo').value,
      weekdays: [...el.querySelectorAll('.oDay:checked')].map((c) => Number(c.value)), discountCents, minOrderCents } });
    renderOffers();
  });
}

/* ---------- Fermetures exceptionnelles ---------- */
async function renderClosures() {
  const el = $('#closuresCard'); if (!el) return;
  const { closures } = await api('/closures');
  el.innerHTML = `<div class="card"><b>🏖️ Fermetures exceptionnelles</b>
    <div class="muted">Congés, jours fériés : les clients ne peuvent plus commander ces jours-là et l'appli affiche la fermeture.</div>
    ${closures.length ? closures.map((c) => `<div class="row" data-closure="${c.id}" style="margin-top:8px"><span class="grow"><b>${c.date_from === c.date_to ? fmtDate(c.date_from) : `${fmtDate(c.date_from)} → ${fmtDate(c.date_to)}`}</b>${c.reason ? ` · ${esc(c.reason)}` : ''}</span><button class="act red sm" data-del>Supprimer</button></div>`).join('') : '<p class="muted">Aucune fermeture prévue.</p>'}
    <div class="row" style="margin-top:12px"><label class="f" style="margin:0">Du <input id="cFrom" type="date"></label><label class="f" style="margin:0">au (inclus) <input id="cTo" type="date"></label>
      <input id="cReason" class="grow" placeholder="Raison (ex : Congés d'été)" maxlength="80"><button class="act" id="cAdd">Ajouter</button></div></div>`;
  el.querySelectorAll('[data-closure]').forEach((row) => {
    row.querySelector('[data-del]').onclick = safe(async () => { await api(`/closures/${row.dataset.closure}`, { method: 'DELETE' }); renderClosures(); });
  });
  $('#cAdd').onclick = safe(async () => {
    const dateFrom = $('#cFrom').value, dateTo = $('#cTo').value || $('#cFrom').value;
    if (!dateFrom) return alert('Choisissez au moins la date de début');
    await api('/closures', { method: 'POST', body: { dateFrom, dateTo, reason: $('#cReason').value } });
    renderClosures();
  });
}

/* ---------- QR code et affiches ---------- */
async function fetchQrSvg(url) {
  const res = await fetch(`/api/admin/qr?url=${encodeURIComponent(url)}`, { headers: { authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('QR code impossible à générer');
  return res.text();
}
function printHtml(html) {
  const w = window.open('', '_blank');
  if (!w) return alert("Autorisez les fenêtres pop-up pour imprimer.");
  w.document.write(html); w.document.close();
  setTimeout(() => w.print(), 300);
}
async function renderQr(publicUrl) {
  const el = $('#qrCard'); if (!el) return;
  const url = publicUrl || `${location.origin}/commande/`;
  el.innerHTML = `<div class="card"><b>📱 QR code et affiches</b>
    <div class="muted">Ce QR code ouvre la commande dans le navigateur, sans rien installer. À mettre sur les boîtes à pizza, au comptoir, sur les flyers.
    Pour un site en ligne, saisissez ici l'adresse publique (https://…).</div>
    <p class="row"><input id="qrUrl" class="grow" value="${esc(url)}"><button class="act sm" id="qrSave">Utiliser cette adresse</button></p>
    <div id="qrBox" style="max-width:220px"></div>
    <p class="row"><button class="act sm" id="qrPoster">🖨 Imprimer l'affiche</button><button class="act sm" id="qrSticker">🖨 Imprimer des autocollants</button></p></div>`;
  const draw = safe(async () => { $('#qrBox').innerHTML = await fetchQrSvg($('#qrUrl').value); });
  await draw();
  $('#qrSave').onclick = safe(async () => { await api('/settings', { method: 'PUT', body: { publicUrl: $('#qrUrl').value.trim() } }); await draw(); });
  const css = '@page{margin:12mm}body{font-family:Arial,sans-serif;text-align:center;color:#222}h1{color:#C8102E}svg{display:block;margin:auto}';
  $('#qrPoster').onclick = safe(async () => {
    const u = $('#qrUrl').value, svg = await fetchQrSvg(u);
    printHtml(`<!doctype html><meta charset="utf-8"><title>Affiche</title><style>${css}h1{font-size:44px;margin:10mm 0 2mm}p{font-size:20px}svg{width:120mm;height:120mm;margin:10mm auto}</style>
      <h1>🍕 Commandez à emporter</h1><p>Scannez, choisissez votre pizza,<br>passez la chercher sans attendre.</p>${svg}<p><b>${esc(u)}</b></p><p>Little Italy · Trans-en-Provence</p>`);
  });
  $('#qrSticker').onclick = safe(async () => {
    const u = $('#qrUrl').value, svg = await fetchQrSvg(u);
    const cell = `<div class="s"><b>Commandez ici 🍕</b>${svg}<small>Little Italy</small></div>`;
    printHtml(`<!doctype html><meta charset="utf-8"><title>Autocollants</title><style>${css}
      .g{display:grid;grid-template-columns:repeat(3,60mm);gap:4mm;justify-content:center}.s{border:1px dashed #bbb;padding:3mm;height:68mm;box-sizing:border-box}.s b{display:block;font-size:14px;margin-bottom:1mm}.s svg{width:46mm;height:46mm}.s small{font-size:12px}</style>
      <div class="g">${cell.repeat(9)}</div>`);
  });
}

/* ---------- Campagnes (offres par notification) ---------- */
async function renderCampaigns() {
  const box = $('#campaignBox'); if (!box) return;
  const c = await api('/campaigns');
  const cooldown = c.next_allowed_at && Date.parse(c.next_allowed_at) > Date.now();
  const SEG = { all: 'Tous', regular: 'Fidèles', dormant: 'À relancer', new: 'Nouveaux' };
  box.innerHTML = `<details class="card"><summary><b>📣 Envoyer une offre par notification</b> <span class="muted">(aux clients qui ont accepté les offres)</span></summary>
    <label class="f">Destinataires<select id="cSeg">${c.segments.map((s) => `<option value="${s.key}">${esc(s.label)} — ${s.count} client${s.count > 1 ? 's' : ''}</option>`).join('')}</select></label>
    <label class="f">Titre (50 caractères max)<input id="cTitle" maxlength="50" placeholder="Ex : Votre pizza vous manque ? 🍕"></label>
    <label class="f">Message (140 caractères max)<textarea id="cBody" rows="2" maxlength="140" placeholder="Ex : Ce soir, une boisson offerte pour toute pizza commandée dans l'appli."></textarea></label>
    ${cooldown ? `<p class="muted">Une offre a été envoyée récemment. Prochain envoi possible le ${new Date(c.next_allowed_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}.</p>` : ''}
    <p class="row"><button class="act" id="cSend" ${cooldown ? 'disabled' : ''}>Envoyer</button><span class="saved" id="cSentOk"></span></p>
    <div class="muted">Seuls les clients qui ont coché « Recevoir les offres » dans l'appli reçoivent le message. Une seule offre tous les 3 jours, pour ne pas envahir les téléphones.</div>
    ${c.history.length ? `<h4 style="margin:12px 0 4px">Dernières offres envoyées</h4>${c.history.map((h) => `<div class="muted">${new Date(h.sent_at).toLocaleDateString('fr-FR')} · ${SEG[h.segment]} (${h.recipients}) · <b>${esc(h.title)}</b> — ${esc(h.body)}</div>`).join('')}` : ''}</details>`;
  $('#cSend').onclick = safe(async () => {
    const seg = $('#cSeg'), n = c.segments.find((s) => s.key === seg.value).count;
    if (!confirm(`Envoyer cette offre à ${n} client${n > 1 ? 's' : ''} ?`)) return;
    try {
      const r = await api('/campaigns', { method: 'POST', body: { segment: seg.value, title: $('#cTitle').value, body: $('#cBody').value } });
      $('#cSentOk').textContent = `✓ Envoyée à ${r.recipients} client${r.recipients > 1 ? 's' : ''}`;
      setTimeout(renderCampaigns, 1500);
    } catch (e) { alert(e.message); }
  });
}

/* ---------- Ticket de cuisine (imprimante thermique 80 mm ou imprimante classique) ---------- */
function ticketHtml(o) {
  const today = parisToday();
  const when = o.pickup_date === today ? '' : `<div class="pre">PRÉCOMMANDE · ${esc(fmtDate(o.pickup_date))}</div>`;
  const pay = o.payment_status === 'paid' ? 'PAYÉ EN LIGNE' : `À ENCAISSER ${euro(o.total_cents)}`;
  const extras = [o.reward_used ? '🎁 PIZZA OFFERTE' : '', o.offer_label ? `Offre ${esc(o.offer_label)}` : '', o.welcome_discount_cents ? 'Bienvenue' : ''].filter(Boolean).join(' · ');
  return `<!doctype html><meta charset="utf-8"><title>Ticket ${o.number}</title>
    <style>@page{size:80mm auto;margin:3mm}body{width:74mm;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#000;margin:0}
    .n{font-size:30px;font-weight:800}.t{font-size:44px;font-weight:800;line-height:1}.pre{background:#000;color:#fff;padding:2px 6px;margin:4px 0;font-weight:700}
    hr{border:0;border-top:2px dashed #000;margin:6px 0}.l{font-size:17px;font-weight:700;margin-top:6px}.d{font-size:13px;margin-left:10px}.note{border:2px solid #000;padding:4px;margin-top:6px;font-weight:700}.pay{font-size:20px;font-weight:800;text-align:center;margin-top:6px}</style>
    <div class="n">N° ${o.number}</div><div class="t">${esc(o.pickup_time)}</div>${when}
    <div>${esc(o.customer_name)} · ${esc(o.phone)}</div><hr>
    ${o.items.map((i) => `<div class="l">${i.quantity} × ${esc(i.name)}</div>${i.details ? `<div class="d">${esc(i.details)}</div>` : ''}`).join('')}
    ${o.note ? `<div class="note">📝 ${esc(o.note)}</div>` : ''}<hr>
    ${extras ? `<div>${extras}</div>` : ''}<div class="pay">${pay}</div>`;
}
function printTicket(o) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write(ticketHtml(o)); f.contentDocument.close();
  setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } finally { setTimeout(() => f.remove(), 3000); } }, 200);
}

/* ---------- Cartes de réglages supplémentaires ---------- */
function extraSettingsHtml(s) {
  const euros = (c) => (c / 100).toFixed(2).replace('.', ',');
  return `
    <div class="card">
      <b>ℹ️ Infos du restaurant</b><div class="muted">Affichées dans l'appli (adresse, appeler, itinéraire, avis Google).</div>
      <label class="f">Adresse<input id="iAddr" maxlength="200" value="${esc(s.info.address)}"></label>
      <div class="row"><label class="f grow">Téléphone<input id="iPhone" inputmode="tel" value="${esc(s.info.phone)}" placeholder="04 94 …"></label>
        <label class="f grow">Lien Google Maps (https://…)<input id="iMaps" value="${esc(s.info.mapsUrl)}"></label></div>
      <label class="f">Lien pour laisser un avis Google (https://…)<input id="iReview" value="${esc(s.info.reviewUrl)}"></label>
      <p class="row"><button class="act" id="iSave">Enregistrer</button><span class="saved" id="iOk"></span></p></div>
    <div class="card">
      <b>📅 Commandes à l'avance et paiement</b>
      <div class="row"><label class="f grow">Commander jusqu'à … jours à l'avance (0 = aujourd'hui seulement)<input id="pDays" type="number" min="0" max="30" value="${s.maxAdvanceDays}"></label>
        <label class="f grow">Paiement en ligne demandé au-delà de … € (0 = jamais)<input id="pOver" inputmode="decimal" value="${euros(s.prepayOverCents)}"></label></div>
      <p><label><input type="checkbox" id="pHold" ${s.holdUnpaid ? 'checked' : ''}> Pizzas à régler au retrait : lancer la pizza quand le client dit « J'arrive »</label></p>
      <div class="muted">Le « J'arrive » évite de cuire des pizzas pour des clients qui ne viennent pas. Le client est invité à vous prévenir ; en cuisine, la commande reste « en attente » tant qu'il n'a pas répondu.</div>
      <p class="row"><button class="act" id="pSave">Enregistrer</button><span class="saved" id="pOk"></span></p></div>
    <div class="card">
      <b>🎁 Offres pour fidéliser</b>
      <div class="row"><label class="f grow">Offre de bienvenue : remise sur la 1re commande € (0 = aucune)<input id="wCents" inputmode="decimal" value="${euros(s.welcomeCents)}"></label>
        <label class="f grow">… à partir de € de commande<input id="wMin" inputmode="decimal" value="${euros(s.welcomeMinCents)}"></label>
        <label class="f grow">Parrainage : tampons offerts au parrain (0 = aucun)<input id="rStamps" type="number" min="0" max="10" value="${s.referralStamps}"></label></div>
      <p class="row"><button class="act" id="wSave">Enregistrer</button><span class="saved" id="wOk"></span></p></div>
    <div id="offersCard"></div><div id="closuresCard"></div><div id="qrCard"></div>`;
}

function setupExtraSettings(s) {
  const eurosToCents = (v) => Math.round(parseFloat(String(v || '0').replace(',', '.')) * 100);
  const save = (btn, ok, body) => ($(btn).onclick = safe(async () => {
    const payload = typeof body === 'function' ? body() : body;
    if (Object.values(payload).some((v) => typeof v === 'number' && isNaN(v))) return alert('Valeur invalide');
    await api('/settings', { method: 'PUT', body: payload });
    $(ok).textContent = '✓ Enregistré';
  }));
  save('#iSave', '#iOk', () => ({ info: { address: $('#iAddr').value, phone: $('#iPhone').value, mapsUrl: $('#iMaps').value, reviewUrl: $('#iReview').value } }));
  save('#pSave', '#pOk', () => ({ maxAdvanceDays: Number($('#pDays').value), prepayOverCents: eurosToCents($('#pOver').value), holdUnpaid: $('#pHold').checked }));
  save('#wSave', '#wOk', () => ({ welcomeCents: eurosToCents($('#wCents').value), welcomeMinCents: eurosToCents($('#wMin').value), referralStamps: Number($('#rStamps').value) }));
  renderOffers().catch(() => {}); renderClosures().catch(() => {}); renderQr(s.publicUrl).catch(() => {});
}
