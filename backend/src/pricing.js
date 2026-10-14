// Calcul des lignes de commande. Tout est recalculé et validé ici à partir de la base :
// le client n'envoie que des identifiants et des choix, jamais de prix.
import { readSettings } from './settings.js';

export class OrderError extends Error {}
const fail = (message) => {
  throw new OrderError(message);
};

const MAX_QTY = 20;
const parseList = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export function shapeItem(row) {
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    description: row.description,
    price_cents: row.price_cents,
    kind: row.kind,
    vegetarian: Boolean(row.vegetarian),
    allergens: parseList(row.allergens),
    ingredients: parseList(row.ingredients),
    sizes: JSON.parse(row.sizes || '[]'),
    image_url: row.image_url,
  };
}

const intList = (v, max, label) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max || v.some((x) => !Number.isInteger(x))) fail(`${label} invalide`);
  return v;
};

function priceItem(db, line, qty) {
  const getItem = db.prepare('SELECT * FROM menu_items WHERE id = ? AND available = 1');
  const row = getItem.get(Number(line.itemId)) ?? fail('Article indisponible');
  const item = shapeItem(row);
  const config = { itemId: item.id, quantity: qty };
  const extrasIds = intList(line.extras, 6, 'Suppléments');
  const removed = line.removed ?? [];
  if (!Array.isArray(removed) || removed.length > 10 || removed.some((x) => typeof x !== 'string')) fail('Ingrédients invalides');

  const hasOptions =
    line.sizeIndex !== undefined || line.halfItemId != null || extrasIds.length > 0 || removed.length > 0;
  if (item.kind !== 'pizza') {
    if (hasOptions) fail('Options indisponibles pour cet article');
    return { name: item.name, details: '', unitCents: item.price_cents, quantity: qty, pizzas: 0, rewardEligible: false, config };
  }

  const details = [];
  let name = item.name;
  let base = item.price_cents;
  let allowed = item.ingredients;

  if (line.halfItemId != null) {
    if (!readSettings(db).halfAndHalf) fail('Moitié-moitié indisponible');
    const halfRow = getItem.get(Number(line.halfItemId)) ?? fail('Pizza indisponible');
    const half = shapeItem(halfRow);
    if (half.kind !== 'pizza' || half.id === item.id) fail('Moitié-moitié invalide');
    name = `½ ${item.name} · ½ ${half.name}`;
    base = Math.max(item.price_cents, half.price_cents); // on facture la plus chère
    allowed = [...new Set([...item.ingredients, ...half.ingredients])];
    config.halfItemId = half.id;
  }

  let sizeExtra = 0;
  if (item.sizes.length) {
    const idx = line.sizeIndex ?? 0;
    if (!Number.isInteger(idx) || idx < 0 || idx >= item.sizes.length) fail('Taille invalide');
    sizeExtra = item.sizes[idx].extra_cents;
    details.push(item.sizes[idx].label);
    config.sizeIndex = idx;
  } else if (line.sizeIndex !== undefined && line.sizeIndex !== 0) fail('Taille invalide');

  let extrasTotal = 0;
  if (extrasIds.length) {
    if (new Set(extrasIds).size !== extrasIds.length) fail('Suppléments en double');
    const getSup = db.prepare('SELECT * FROM supplements WHERE id = ? AND available = 1');
    const names = [];
    for (const id of extrasIds) {
      const s = getSup.get(id) ?? fail('Supplément indisponible');
      extrasTotal += s.price_cents;
      names.push(s.name);
    }
    details.push('+ ' + names.join(', '));
    config.extras = extrasIds;
  }

  if (removed.length) {
    const unique = [...new Set(removed)];
    if (unique.some((r) => !allowed.includes(r))) fail('Ingrédient inconnu');
    details.push('sans ' + unique.join(', '));
    config.removed = unique;
  }

  return {
    name,
    details: details.join(' · '),
    unitCents: base + sizeExtra + extrasTotal,
    quantity: qty,
    pizzas: qty,
    rewardEligible: true,
    config,
  };
}

function priceCombo(db, line, qty) {
  const combo = db.prepare('SELECT * FROM combos WHERE id = ? AND available = 1').get(Number(line.comboId)) ?? fail('Formule indisponible');
  const slots = JSON.parse(combo.slots);
  const picks = intList(line.picks, 10, 'Choix');
  if (picks.length !== slots.length) fail('Composez toute la formule');
  const getItem = db.prepare('SELECT * FROM menu_items WHERE id = ? AND available = 1');
  const names = picks.map((id, i) => {
    const it = getItem.get(id) ?? fail('Article indisponible');
    if (it.kind !== slots[i]) fail('Choix incompatible avec la formule');
    return it.name;
  });
  return {
    name: combo.name,
    details: names.join(' + '),
    unitCents: combo.price_cents,
    quantity: qty,
    pizzas: slots.filter((k) => k === 'pizza').length * qty,
    rewardEligible: false,
    config: { comboId: combo.id, picks, quantity: qty },
  };
}

export function priceLine(db, line) {
  if (!line || typeof line !== 'object') fail('Panier invalide');
  const qty = Number(line.quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) fail('Quantité invalide');
  return line.comboId !== undefined ? priceCombo(db, line, qty) : priceItem(db, line, qty);
}
