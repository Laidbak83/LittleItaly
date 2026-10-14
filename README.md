# Little Italy – commande de pizzas à emporter

Application iOS / Android pour le restaurant Little Italy (Trans-en-Provence).

| Dossier | Rôle |
|---|---|
| `mobile/` | Appli client (React Native + Expo) |
| `backend/` | API (Node 22 + Fastify + SQLite) et **interface web d'Olivier** sur `/admin` |

## Fonctions

**Côté client (appli)**
- Carte avec photos, filtre 🌱 végétarien et **allergènes** affichés (quand ils sont renseignés)
- **Pizzas personnalisables** : suppléments payants (1 €), ingrédients à retirer ; tailles et moitié-moitié en option
- **Pizza Duo** à 14 € (demi-pizza au choix + salade chèvre / antipasti / chicken) et formules à prix fixe
- Suggestions au panier (« Un petit extra ? » : boisson, dessert)
- Choix de l'heure de retrait, paiement **en ligne (Stripe) ou au retrait**
- **Carte de fidélité** : 1 pizza retirée = 1 tampon, 10 tampons = 1 pizza offerte (la moins chère du panier)
- **Commander à nouveau** en un clic, suivi de commande, notification « commande prête »

**Côté Olivier (`/admin`, sur tablette ou téléphone)**
- Commandes en direct (bip à chaque nouvelle commande), détail des options de chaque pizza
- **Régulation du four** : maximum de pizzas par créneau de 15 min (créneau grisé quand il est plein), mode **« rush »** (+10 à +60 min de préparation), bouton **Ouvert / Fermé**
- Message en haut de l'appli (pizza du moment, promo, congés…)
- Édition de la carte : prix, disponibilité, photos, allergènes, tailles, ingrédients, suppléments, formules, moitié-moitié (désactivé par défaut)

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

**Écran de la cuisine** : ouvrir <http://localhost:3000/admin> (code `dev-admin`) dans le navigateur du PC. Pour le voir sur une tablette ou un téléphone du même Wi-Fi : `http://<IP-du-PC>:3000/admin` (autoriser Node.js dans le pare-feu Windows s'il le demande).
En mode `npm run dev`, les créneaux de retrait sont **ouverts 24h/24** pour pouvoir tester à toute heure (`OPEN_ALL_DAY=1` dans `backend/.env.dev`, jamais en production).

**Commandes de démonstration pour la cuisine** (sans passer par l'appli) : `npm run demo` dans `backend`.

### Scénario de test conseillé

1. **Appli** : ouvrir une pizza (ex. Calzone), ajouter un supplément, retirer un ingrédient, l'ajouter ; commander un Pizza Duo ; aller au *Panier* ; accepter une suggestion (boisson/dessert) ; choisir un créneau, saisir prénom et téléphone ; **Envoyer la commande**.
2. **Cuisine** (`/admin`) : la commande apparaît avec un bip (cliquer une fois sur la page pour autoriser le son) et le détail des options. Cliquer **Préparer**, puis **Prête ✓**.
3. **Appli**, onglet *Commande* : le statut avance tout seul (rafraîchi toutes les 5 s).
4. **Cuisine** : cliquer **Retirée**. **Appli**, onglet *Fidélité* : un tampon par pizza apparaît.
5. **Régulation** (`/admin` → *Réglages*) : passer en **Fermé** puis changer d'onglet dans l'appli → « commandes fermées » ; mettre le maximum de pizzas par créneau à 2 et commander 3 pizzas → créneau refusé ; ajouter un message en bannière → il s'affiche en haut de la carte.
6. **Carte** (`/admin` → *Carte*) : changer un prix, masquer un article, ajouter une photo, saisir des allergènes → tirer l'écran de la carte vers le bas dans l'appli pour recharger.
7. **Fidélité complète** : mettre 10 pizzas dans une commande, la passer en *Retirée* dans la cuisine → une **pizza offerte** apparaît dans l'appli au prochain panier.

Notes pour le test dans Expo Go :
- **Au retrait** fonctionne directement. Le paiement **en ligne** demande des clés Stripe de test (voir `backend/.env.example`, carte de test `4242 4242 4242 4242`).
- Les **notifications push** ne fonctionnent pas dans Expo Go sur Android (elles nécessitent un build de l'appli) : la commande, elle, fonctionne normalement.
- Pour repartir de zéro : arrêter le backend et supprimer le dossier `backend/data/`.

## La carte chargée (d'après la carte affichée au restaurant)

- **11 pizzas** (Pacino, Berges, Scorcese, De Palma, Tarentino, Pesci, Phoenix, Fraticelli, Pop Toys, Soprano's, Calzone) au **tarif unique emporté de 11,50 €**, supplément **1,00 €**
- **3 Pizza Duo** à 14 €, boissons froides, crêpes, tiramisu et mousse au chocolat
- **Masqués par défaut** (à activer dans `/admin` → Carte si Olivier les vend à emporter) : lasagne, 4 salades, tarte tatin
- **Non repris** : boissons chaudes, bières, vins, apéritifs, glaces, tartares/carpaccios, viandes/poissons, pâtes fraîches (choix de sauce à modéliser), plat du jour, menus
- **Horaires de retrait** : lun–mer jusqu'à 19h, jeu–sam jusqu'à 22h, dimanche jusqu'à 15h (pas de pizza le dimanche soir). Début à **11h30 = hypothèse** : `backend/src/config.js`

## À faire avant la mise en production

- [ ] **Vérifier la carte avec Olivier** : prix et descriptions (relevés sur une photo de la carte), liste des suppléments proposés (hypothèse), mentions « végétarien » (déduites des ingrédients), et **renseigner les allergènes** (laissés vides volontairement : à saisir par le restaurant dans `/admin` → Carte).
- [ ] **Horaires de retrait** (début à 11h30, dernier retrait = heure de fermeture) : `backend/src/config.js`. Capacité du four et rush : réglables dans `/admin` → *Réglages*.
- [ ] **Hébergement du backend** en HTTPS, avec un `ADMIN_TOKEN` fort (`backend/.env.example`). La base SQLite et les photos sont dans `backend/data/` : prévoir un volume persistant et des sauvegardes. Définir `EXPO_PUBLIC_API_URL` pour l'appli (`mobile/.env.example`).
- [ ] **Stripe** : compte du restaurant, clés dans `.env`, webhook `payment_intent.succeeded` → `https://<serveur>/api/stripe/webhook`. Pour Apple Pay, ajouter `merchantIdentifier` dans le plugin Stripe de `mobile/app.json`.
- [ ] **Notifications push** : `eas init` (renseigne `extra.eas.projectId` dans `app.json`) puis configurer les identifiants push (FCM pour Android, APNs pour iOS).
- [ ] **Publication** : comptes développeur Apple (99 €/an) et Google Play (25 € une fois) au nom du restaurant, identifiants d'app `fr.littleitaly.commande` à valider, icône et splash définitifs, puis `eas build` / `eas submit`.
- [ ] Mentions légales et politique de confidentialité (nom et téléphone collectés) : exigées par les stores.
- [ ] Règles de fidélité à valider avec Olivier (10 tampons, 1 tampon par pizza, pizza offerte = la moins chère, formules non éligibles à la pizza offerte).
