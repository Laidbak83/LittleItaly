// Offres envoyées par notification aux clients qui ont donné leur accord (case cochée dans l'appli).
import { listCustomers } from './stats.js';

export const SEGMENTS = {
  all: 'Tous les clients qui acceptent les offres',
  regular: 'Clients fidèles (3 commandes et +)',
  dormant: 'Clients à relancer (inactifs depuis plus de 30 jours)',
  new: 'Nouveaux clients (30 derniers jours)',
};
export const COOLDOWN_HOURS = 72; // pas plus d'une campagne tous les 3 jours : on n'envahit pas les téléphones

// Appareils qui ont accepté les offres, filtrés par segment (le segment se calcule par numéro de téléphone).
export function audience(db, config, now, segment) {
  const consenting = db.prepare('SELECT loyalty_id, push_token FROM devices WHERE marketing = 1 AND push_token IS NOT NULL').all();
  if (segment === 'all') return consenting;
  const phones = new Set(listCustomers(db, config, now).filter((c) => c.segment === segment).map((c) => c.phone));
  const ids = new Set(
    db
      .prepare("SELECT DISTINCT phone, loyalty_id FROM orders WHERE loyalty_id IS NOT NULL AND status NOT IN ('cancelled','pending_payment')")
      .all()
      .filter((o) => phones.has(o.phone))
      .map((o) => o.loyalty_id),
  );
  return consenting.filter((d) => ids.has(d.loyalty_id));
}

export function nextAllowedAt(db) {
  const last = db.prepare('SELECT sent_at FROM campaigns ORDER BY sent_at DESC LIMIT 1').get();
  return last ? new Date(Date.parse(last.sent_at) + COOLDOWN_HOURS * 3600000).toISOString() : null;
}
