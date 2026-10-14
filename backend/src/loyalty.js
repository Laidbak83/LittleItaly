// Carte de fidélité : 1 pizza retirée = 1 tampon, 10 tampons = 1 pizza offerte.
// Le client est identifié par un identifiant aléatoire stocké dans l'appli (pas de compte).
export const REWARD_TARGET = 10;
export const isValidLoyaltyId = (id) => typeof id === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(id);

export function loyaltyStatus(db, id) {
  const row = db.prepare('SELECT stamps, rewards_used FROM loyalty WHERE customer_id = ?').get(id);
  const stamps = row?.stamps ?? 0;
  const earned = Math.floor(stamps / REWARD_TARGET);
  return {
    progress: stamps % REWARD_TARGET,
    target: REWARD_TARGET,
    rewardsAvailable: Math.max(0, earned - (row?.rewards_used ?? 0)),
    totalStamps: stamps,
  };
}

const upsertRow = (db, id) =>
  db.prepare('INSERT INTO loyalty (customer_id) VALUES (?) ON CONFLICT(customer_id) DO NOTHING').run(id);

export function addStamps(db, id, n) {
  if (n <= 0) return;
  upsertRow(db, id);
  db.prepare('UPDATE loyalty SET stamps = stamps + ? WHERE customer_id = ?').run(n, id);
}
export function consumeReward(db, id) {
  upsertRow(db, id);
  db.prepare('UPDATE loyalty SET rewards_used = rewards_used + 1 WHERE customer_id = ?').run(id);
}
export function refundReward(db, id) {
  db.prepare('UPDATE loyalty SET rewards_used = MAX(rewards_used - 1, 0) WHERE customer_id = ?').run(id);
}
