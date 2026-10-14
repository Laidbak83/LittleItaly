// Paiement en ligne : natif uniquement. La version web utilise stripe.web.ts (paiement au retrait pour l'instant).
export { initStripe, initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
