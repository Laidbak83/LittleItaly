# Little Italy – commande de pizzas à emporter

Application iOS / Android pour le restaurant Little Italy (Trans-en-Provence).

| Dossier | Rôle |
|---|---|
| `mobile/` | Appli client (React Native + Expo) |
| `backend/` | API (Node 22 + Fastify + SQLite) et **interface web d'Olivier** sur `/admin` |

## Fonctions

**Côté client (appli)**
- Carte avec photos, filtre 🌱 végétarien et **allergènes** affichés
- **Pizzas personnalisables** : taille, moitié-moitié, suppléments payants, ingrédients à retirer
- **Formules** (ex. pizza + boisson + dessert à prix fixe)
- Suggestions au panier (« Un petit extra ? » : boisson, dessert)
- Choix de l'heure de retrait, paiement **en ligne (Stripe) ou au retrait**
- **Carte de fidélité** : 1 pizza retirée = 1 tampon, 10 tampons = 1 pizza offerte (la moins chère du panier)
- **Commander à nouveau** en un clic, suivi de commande, notification « commande prête »

**Côté Olivier (`/admin`, sur tablette ou téléphone)**
- Commandes en direct (bip à chaque nouvelle commande), détail des options de chaque pizza
- **Régulation du four** : maximum de pizzas par créneau de 15 min (créneau grisé quand il est plein), mode **« rush »** (+10 à +60 min de préparation), bouton **Ouvert / Fermé**
- Message en haut de l'appli (pizza du moment, promo, congés…)
- Édition de la carte : prix, disponibilité, photos, allergènes, tailles, ingrédients, suppléments, formules

Les prix sont toujours recalculés et validés côté serveur : l'appli n'envoie que des identifiants et des choix.

## Tester en local (Windows + émulateur Android)

Prérequis : **Node.js 22.13 ou plus** (LTS), **Android Studio** avec un appareil virtuel (AVD) créé et démarré.

**1. Backend** (un premier terminal)
```bash
cd backend
npm install
npm run dev
```
Interface d'Olivier : <http://localhost:3000/admin> — code d'accès de développement : `dev-admin`.
Tests automatiques : `npm test`.

**2. Appli** (un second terminal)
```bash
cd mobile
npm install
npx expo start
```
Quand l'émulateur est lancé, appuyer sur **`a`** : Expo installe *Expo Go* dans l'émulateur et ouvre l'appli.
L'émulateur joint automatiquement le backend du PC (`http://10.0.2.2:3000`), rien à configurer.

Notes pour le test dans Expo Go :
- **Au retrait** fonctionne directement. Le paiement **en ligne** demande des clés Stripe de test (voir `backend/.env.example`, carte de test `4242 4242 4242 4242`).
- Les **notifications push** ne fonctionnent pas dans Expo Go sur Android (elles nécessitent un build de l'appli) : la commande, elle, fonctionne normalement.
- Pour tester la fidélité sans attendre 10 commandes : passer des commandes puis les marquer « Retirée » dans `/admin` (chaque pizza = 1 tampon).
- Pour repartir de zéro : arrêter le backend et supprimer `backend/data/`.

## À faire avant la mise en production

- [ ] **Carte** : tout le contenu fourni (pizzas, prix, tailles, suppléments, formules, **allergènes**) est un exemple à remplacer dans `/admin` → *Carte*. Les allergènes doivent être vérifiés par le restaurant.
- [ ] **Horaires, jours de fermeture, délai de préparation** : `backend/src/config.js` (valeurs actuelles = hypothèses). Capacité du four et rush : réglables dans `/admin` → *Réglages*.
- [ ] **Hébergement du backend** en HTTPS, avec un `ADMIN_TOKEN` fort (`backend/.env.example`). La base SQLite et les photos sont dans `backend/data/` : prévoir un volume persistant et des sauvegardes. Définir `EXPO_PUBLIC_API_URL` pour l'appli (`mobile/.env.example`).
- [ ] **Stripe** : compte du restaurant, clés dans `.env`, webhook `payment_intent.succeeded` → `https://<serveur>/api/stripe/webhook`. Pour Apple Pay, ajouter `merchantIdentifier` dans le plugin Stripe de `mobile/app.json`.
- [ ] **Notifications push** : `eas init` (renseigne `extra.eas.projectId` dans `app.json`) puis configurer les identifiants push (FCM pour Android, APNs pour iOS).
- [ ] **Publication** : comptes développeur Apple (99 €/an) et Google Play (25 € une fois) au nom du restaurant, identifiants d'app `fr.littleitaly.commande` à valider, icône et splash définitifs, puis `eas build` / `eas submit`.
- [ ] Mentions légales et politique de confidentialité (nom et téléphone collectés) : exigées par les stores.
- [ ] Règles de fidélité à valider avec Olivier (10 tampons, 1 tampon par pizza, pizza offerte = la moins chère, formules non éligibles à la pizza offerte).
