// Réglages du restaurant. Les horaires sont à CONFIRMER avec Olivier.
export function loadConfig(env = process.env) {
  const config = {
    port: Number(env.PORT ?? 3000),
    adminToken: env.ADMIN_TOKEN ?? '',
    dbPath: env.DB_PATH ?? './data/littleitaly.db',
    uploadsDir: env.UPLOADS_DIR ?? '', // par défaut : <dossier de la base>/uploads
    stripeSecretKey: env.STRIPE_SECRET_KEY ?? '',
    stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY ?? '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
    // Identifiant de contact exigé par les notifications web (mailto: ou https:). À remplacer par une vraie adresse.
    vapidSubject: env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
    timezone: 'Europe/Paris',
    slotMinutes: 15,
    leadMinutes: 20, // délai minimum de préparation
    // Créneaux de retrait par jour (0 = dimanche … 6 = samedi), d'après les horaires affichés :
    // lun-mer 8h-19h, jeu-sam 8h-22h (service continu), dim 8h-15h, pas de pizza le dimanche soir.
    // Le début à 11h30 est une HYPOTHÈSE (pas de pizza à 8h) : à confirmer avec Olivier.
    hoursByWeekday: {
      0: [['11:30', '15:00']],
      1: [['11:30', '19:00']],
      2: [['11:30', '19:00']],
      3: [['11:30', '19:00']],
      4: [['11:30', '22:00']],
      5: [['11:30', '22:00']],
      6: [['11:30', '22:00']],
    },
    maxItemQty: 20,
  };
  // Mode TEST (développement uniquement, via .env.dev) : créneaux ouverts toute la journée,
  // pour pouvoir commander à n'importe quelle heure. Ne JAMAIS activer en production.
  if (env.OPEN_ALL_DAY === '1') {
    for (const day of Object.keys(config.hoursByWeekday)) config.hoursByWeekday[day] = [['00:00', '23:45']];
  }
  return config;
}
