// Notification Expo envoyée au client quand sa commande est prête.
export async function sendPush(token, title, body, fetchImpl = fetch) {
  if (!token || !/^Expo(nent)?PushToken\[.+\]$/.test(token)) return;
  try {
    await fetchImpl('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: token, title, body, sound: 'default' }),
    });
  } catch (err) {
    console.error('push failed', err.message);
  }
}
