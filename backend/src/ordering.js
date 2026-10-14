// Calcul d'une commande (devis) : lignes, remises et total. C'est LA seule source de vérité des prix :
// l'appli affiche exactement ce que renvoie le devis, et la commande réutilise le même calcul.
import { randomInt } from 'node:crypto';
import { loyaltyStatus } from './loyalty.js';
import { OrderError, priceLine } from './pricing.js';
import { activeFeatured, readSettings } from './settings.js';
import { addDays, weekdayOf } from './time.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I : faciles à dicter

// ---------- Offres sur les créneaux creux ----------
export function offersFor(db, date, time) {
  const weekday = String(weekdayOf(date));
  return db
    .prepare('SELECT * FROM slot_offers WHERE active = 1 AND start_time <= ? AND ? < end_time')
    .all(time, time)
    .filter((o) => o.weekdays === '' || o.weekdays.split(',').includes(weekday));
}
// La meilleure offre applicable (la plus généreuse) ; subtotal = montant de la commande si on le connaît.
export function bestOffer(db, date, time, subtotal = Infinity) {
  return offersFor(db, date, time)
    .filter((o) => subtotal >= o.min_order_cents)
    .sort((a, b) => b.discount_cents - a.discount_cents)[0] ?? null;
}

// ---------- Première commande, parrainage ----------
export function isFirstOrder(db, loyaltyId, phone) {
  const clauses = [], params = [];
  if (loyaltyId) { clauses.push('loyalty_id = ?'); params.push(loyaltyId); }
  if (phone) { clauses.push('phone = ?'); params.push(phone); }
  if (!clauses.length) return false;
  return !db.prepare(`SELECT 1 FROM orders WHERE status NOT IN ('cancelled','pending_payment') AND (${clauses.join(' OR ')}) LIMIT 1`).get(...params);
}

export function referralCodeFor(db, loyaltyId) {
  const row = db.prepare('SELECT code FROM referral_codes WHERE loyalty_id = ?').get(loyaltyId);
  if (row) return row.code;
  for (let i = 0; i < 25; i++) {
    const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    try {
      db.prepare('INSERT INTO referral_codes (loyalty_id, code) VALUES (?,?)').run(loyaltyId, code);
      return code;
    } catch {
      // collision de code : on en tire un autre
    }
  }
  throw new Error('Impossible de créer un code de parrainage');
}
const ownerOfCode = (db, code) => db.prepare('SELECT loyalty_id FROM referral_codes WHERE code = ?').get(String(code).trim().toUpperCase())?.loyalty_id ?? null;

// ---------- Devis ----------
// input : { items, pickupDate?, pickupTime?, loyaltyId?, useReward?, phone?, referralCode? }
export function buildQuote({ db, today, onlinePayment }, input) {
  const settings = readSettings(db);
  const date = input.pickupDate ?? today;
  if (typeof date !== 'string' || !DATE_RE.test(date) || date < today || date > addDays(today, settings.maxAdvanceDays)) {
    throw new OrderError(settings.maxAdvanceDays > 0 ? `Choisissez un jour entre aujourd'hui et dans ${settings.maxAdvanceDays} jours` : "Les commandes se font pour aujourd'hui uniquement");
  }
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 50) throw new OrderError('Panier vide');

  // Les articles « épuisés aujourd'hui » ne bloquent que les commandes du jour.
  const ctx = { featured: activeFeatured(db, settings, date), today: date === today ? today : null };
  const lines = input.items.map((l) => priceLine(db, l, ctx));
  const pizzaCount = lines.reduce((n, l) => n + l.pizzas, 0);
  const subtotal = lines.reduce((s, l) => s + l.unitCents * l.quantity, 0);

  // Pizza offerte (fidélité) : la moins chère des pizzas, hors formules.
  let reward = 0;
  if (input.useReward) {
    if (!input.loyaltyId) throw new OrderError('Carte de fidélité requise');
    const eligible = lines.filter((l) => l.rewardEligible);
    if (!eligible.length) throw new OrderError('Ajoutez une pizza pour utiliser votre récompense');
    if (loyaltyStatus(db, input.loyaltyId).rewardsAvailable < 1) throw new OrderError('Aucune pizza offerte disponible');
    reward = Math.min(...eligible.map((l) => l.unitCents));
  }

  // Offre de bienvenue (1re commande) et code ami.
  const firstOrder = isFirstOrder(db, input.loyaltyId, input.phone);
  const welcome = firstOrder && settings.welcomeCents > 0 && subtotal >= settings.welcomeMinCents ? Math.min(settings.welcomeCents, subtotal - reward) : 0;
  let referredBy = null;
  if (input.referralCode) {
    if (settings.referralStamps === 0) throw new OrderError("Le parrainage n'est pas proposé");
    const owner = ownerOfCode(db, input.referralCode);
    if (!owner) throw new OrderError('Code ami inconnu');
    if (owner === input.loyaltyId) throw new OrderError('Vous ne pouvez pas utiliser votre propre code');
    if (!firstOrder) throw new OrderError('Un code ami ne fonctionne que sur une première commande');
    referredBy = owner;
  }

  // Remise heures creuses selon le créneau choisi.
  let offer = null;
  if (input.pickupTime) {
    const o = bestOffer(db, date, input.pickupTime, subtotal);
    const cents = o ? Math.min(o.discount_cents, subtotal - reward - welcome) : 0;
    if (o && cents > 0) offer = { id: o.id, label: o.label, cents };
  }

  const total = subtotal - reward - welcome - (offer?.cents ?? 0);
  return {
    date, lines, pizzaCount, subtotal, reward, welcome, offer, total, referredBy, firstOrder,
    requiresOnline: settings.prepayOverCents > 0 && onlinePayment && total > settings.prepayOverCents,
  };
}
