// Réglages du restaurant. Les horaires sont à CONFIRMER avec Olivier.
export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT ?? 3000),
    adminToken: env.ADMIN_TOKEN ?? '',
    dbPath: env.DB_PATH ?? './data/littleitaly.db',
    uploadsDir: env.UPLOADS_DIR ?? '', // par défaut : <dossier de la base>/uploads
    stripeSecretKey: env.STRIPE_SECRET_KEY ?? '',
    stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY ?? '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
    timezone: 'Europe/Paris',
    slotMinutes: 15,
    leadMinutes: 20, // délai minimum de préparation
    // Plages d'ouverture (heure locale). À ajuster.
    hours: [
      ['11:30', '14:00'],
      ['18:00', '22:00'],
    ],
    // Jours de fermeture, 0 = dimanche … 6 = samedi. À ajuster.
    closedWeekdays: [],
    maxItemQty: 20,
  };
}
