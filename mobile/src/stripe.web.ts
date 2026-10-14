// Version web : le paiement en ligne n'est pas encore proposé (le client règle au retrait ou utilise l'appli).
const unavailable = { error: { code: 'Unavailable', message: "Le paiement en ligne n'est pas disponible sur le site." } } as const;
export const initStripe = async (_params?: unknown) => {};
export const initPaymentSheet = async (_params?: unknown) => unavailable;
export const presentPaymentSheet = async () => unavailable;
