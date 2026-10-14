// Notification Expo envoyée au client quand sa commande est prête.
export async function sendPush(token, title, body, fetchImpl = fetch, data = {}) {
  if (!token || !/^Expo(nent)?PushToken\[.+\]$/.test(token)) return;
  try {
    await fetchImpl('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: token, title, body, data, sound: 'default', channelId: 'default', priority: 'high' }),
    });
  } catch (err) {
    console.error('push failed', err.message);
  }
}

// Envoi groupé (campagnes) : l'API Expo accepte jusqu'à 100 messages par requête.
export async function sendPushBatch(messages, fetchImpl = fetch) {
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100).map((m) => ({ sound: 'default', channelId: 'default', ...m }));
    try {
      await fetchImpl('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chunk),
      });
      sent += chunk.length;
    } catch (err) {
      console.error('push batch failed', err.message);
    }
  }
  return sent;
}
