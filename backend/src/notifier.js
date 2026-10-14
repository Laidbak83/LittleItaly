// Notifications : aux clients (Expo push, sur leur téléphone) et à Olivier (notifications web de l'écran admin installé).
// Les rappels « bientôt prête », « votre commande vous attend », « notez votre pizza », « commande en retard » et le
// bilan du soir sont envoyés par tick(), appelé toutes les 30 secondes par le serveur.
import webpush from 'web-push';
import { typicalPrepMinutes } from './kitchen.js';
import { sendPush } from './push.js';
import { readSettings } from './settings.js';
import { localNow, localToDate } from './time.js';

const DEFAULT_PREP_MINUTES = 12; // tant qu'on n'a pas mesuré
const WAITING_AFTER_MIN = 10; // « votre commande vous attend » : 10 min après l'heure de retrait / la fin de préparation
const RATE_AFTER_MIN = 30; // invitation à noter : 30 min après le retrait
const LATE_AFTER_MIN = 5; // alerte patron : commande pas prête 5 min après l'heure de retrait
const SUMMARY_AFTER_CLOSING_MIN = 10;

const euro = (c) => `${(c / 100).toFixed(2).replace('.', ',')} €`;
const minutes = (ms) => ms / 60000;

export function createNotifier({ db, config, now, fetchImpl = fetch, webPush = webpush, log = () => {} }) {
  const pending = new Set();
  const track = (promise) => {
    const p = promise.catch((err) => log('notification', err?.message ?? err)).finally(() => pending.delete(p));
    pending.add(p);
    return p;
  };

  const getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
  const setSetting = (k, v) =>
    db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);

  // Clés VAPID (identité du serveur pour les notifications web) : créées au premier besoin puis conservées en base.
  function vapid() {
    let publicKey = getSetting('vapid_public');
    let privateKey = getSetting('vapid_private');
    if (!publicKey || !privateKey) {
      ({ publicKey, privateKey } = webPush.generateVAPIDKeys());
      setSetting('vapid_public', publicKey);
      setSetting('vapid_private', privateKey);
    }
    return { publicKey, privateKey, subject: config.vapidSubject };
  }

  async function sendToOwner(payload) {
    const subs = db.prepare('SELECT * FROM owner_subscriptions').all();
    if (!subs.length) return 0;
    const v = vapid();
    let sent = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webPush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ url: '/admin', ...payload }), {
            vapidDetails: { subject: v.subject, publicKey: v.publicKey, privateKey: v.privateKey },
            TTL: 3600,
            urgency: 'high',
          });
          sent++;
        } catch (err) {
          // Abonnement expiré ou désinstallé : on l'oublie.
          if (err?.statusCode === 404 || err?.statusCode === 410) db.prepare('DELETE FROM owner_subscriptions WHERE endpoint = ?').run(s.endpoint);
          else log('push patron', err?.message ?? err);
        }
      }),
    );
    return sent;
  }

  // kind : 'newOrder' | 'late' | 'summary' (chaque type peut être coupé dans les réglages)
  const notifyOwner = (kind, payload) => (readSettings(db).ownerNotify[kind] ? sendToOwner(payload) : Promise.resolve(0));
  const toCustomer = (order, title, body) => sendPush(order.push_token, title, body, fetchImpl, { orderId: order.id });

  const pickupAt = (order) => localToDate(config.timezone, order.pickup_date, order.pickup_time);
  const summarize = (items) => {
    const text = items.map((i) => `${i.quantity}× ${i.name}`).join(', ');
    return text.length > 90 ? `${text.slice(0, 87)}…` : text;
  };

  return {
    // Une commande vient d'arriver en cuisine (au retrait, ou paiement en ligne confirmé).
    orderPlaced(order) {
      return track(
        notifyOwner('newOrder', {
          title: `🍕 Nouvelle commande n°${order.number}`,
          body: `${order.customer_name.split(' ')[0]} · retrait ${order.pickup_time} · ${euro(order.total_cents)} · ${summarize(order.items)}`,
          tag: `order-${order.id}`,
        }),
      );
    },

    // La cuisine a changé le statut d'une commande.
    statusChanged(order, status) {
      if (status === 'preparing') {
        return track(toCustomer(order, 'Commande acceptée 👨‍🍳', `Nous préparons votre commande n°${order.number}. Retrait à ${order.pickup_time}.`));
      }
      if (status === 'ready') {
        return track(toCustomer(order, 'Votre commande est prête 🍕', `Commande n°${order.number} à retirer chez Little Italy.`));
      }
      if (status === 'cancelled') {
        return track(toCustomer(order, 'Commande annulée', `Votre commande n°${order.number} a été annulée par le restaurant. N'hésitez pas à nous appeler.`));
      }
      return Promise.resolve();
    },

    async sendTest() {
      return sendToOwner({ title: '🔔 Notifications activées', body: 'Vous recevrez ici les nouvelles commandes de Little Italy.', tag: 'test' });
    },

    vapidPublicKey: () => vapid().publicKey,

    // Notifications planifiées. Renvoie ce qui a été envoyé (utile aux tests). Idempotent : chaque envoi est marqué en base.
    async tick() {
      const t = now();
      const local = localNow(config.timezone, t);
      const sent = { soon: 0, waiting: 0, rate: 0, late: 0, summary: 0 };
      const mark = (col, id) => db.prepare(`UPDATE orders SET ${col} = 1 WHERE id = ?`).run(id);

      // 1. « Bientôt prête » : un peu avant la fin habituelle de préparation (mesurée, sinon 12 min).
      const typical = typicalPrepMinutes(db, config, t) ?? DEFAULT_PREP_MINUTES;
      const soonAfter = Math.max(3, Math.round(typical) - 3);
      for (const o of db.prepare("SELECT * FROM orders WHERE status = 'preparing' AND notified_soon = 0 AND push_token IS NOT NULL AND preparing_at IS NOT NULL").all()) {
        if (minutes(t - Date.parse(o.preparing_at)) < soonAfter) continue;
        mark('notified_soon', o.id);
        await track(toCustomer(o, 'Bientôt prête ⏳', `Plus que quelques minutes avant que votre commande n°${o.number} soit prête.`));
        sent.soon++;
      }

      // 2. « Votre commande vous attend » : prête, mais pas retirée.
      for (const o of db.prepare("SELECT * FROM orders WHERE status = 'ready' AND notified_waiting = 0 AND push_token IS NOT NULL AND ready_at IS NOT NULL").all()) {
        const since = Math.max(Date.parse(o.ready_at), pickupAt(o).getTime());
        if (minutes(t - since) < WAITING_AFTER_MIN) continue;
        mark('notified_waiting', o.id);
        await track(toCustomer(o, 'Votre pizza vous attend 🍕', `Votre commande n°${o.number} est prête : elle refroidit, passez la chercher !`));
        sent.waiting++;
      }

      // 3. Invitation à noter les pizzas, une fois, 30 min après le retrait.
      const dayAgo = new Date(t.getTime() - 24 * 3600 * 1000).toISOString();
      for (const o of db.prepare("SELECT * FROM orders WHERE status = 'done' AND notified_rate = 0 AND push_token IS NOT NULL AND pizza_count > 0 AND done_at IS NOT NULL AND done_at > ?").all(dayAgo)) {
        if (minutes(t - Date.parse(o.done_at)) < RATE_AFTER_MIN) continue;
        mark('notified_rate', o.id);
        if (db.prepare('SELECT 1 FROM ratings WHERE order_id = ?').get(o.id)) continue;
        await track(toCustomer(o, 'Comment était votre pizza ? ⭐', 'Notez-la en 10 secondes dans l’appli.'));
        sent.rate++;
      }

      // 4. Alerte patron : commande pas prête alors que l'heure de retrait est dépassée.
      for (const o of db.prepare("SELECT * FROM orders WHERE status IN ('new','preparing') AND notified_late = 0 AND pickup_date >= ?").all(localNowMinusDays(local.date, 1))) {
        if (minutes(t - pickupAt(o)) < LATE_AFTER_MIN) continue;
        mark('notified_late', o.id);
        await track(
          notifyOwner('late', {
            title: `⏰ Commande n°${o.number} en retard`,
            body: `Retrait prévu à ${o.pickup_time} pour ${o.customer_name.split(' ')[0]} — pas encore prête.`,
            tag: `late-${o.id}`,
          }),
        );
        sent.late++;
      }

      // 5. Bilan du soir, une fois par jour, un peu après la fermeture.
      const ranges = config.hoursByWeekday[local.weekday] ?? [];
      if (ranges.length && getSetting('last_summary_date') !== local.date) {
        const [h, m] = ranges.at(-1)[1].split(':').map(Number);
        if (local.minutes >= h * 60 + m + SUMMARY_AFTER_CLOSING_MIN) {
          setSetting('last_summary_date', local.date);
          const day = db
            .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS revenue, COALESCE(SUM(pizza_count),0) AS pizzas FROM orders WHERE status NOT IN ('cancelled','pending_payment') AND pickup_date = ?")
            .get(local.date);
          if (day.n > 0) {
            await track(
              notifyOwner('summary', {
                title: '📊 Bilan du jour',
                body: `${day.n} commande${day.n > 1 ? 's' : ''} · ${euro(day.revenue)} · ${day.pizzas} pizza${day.pizzas > 1 ? 's' : ''}`,
                tag: 'summary',
              }),
            );
            sent.summary++;
          }
        }
      }
      return sent;
    },

    // Attend la fin des envois en cours (tests).
    flush: () => Promise.all([...pending]),
  };
}

function localNowMinusDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
