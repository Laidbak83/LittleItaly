# Little Italy – commande de pizzas à emporter

Application iOS / Android pour le restaurant Little Italy (Trans-en-Provence).

| Dossier | Rôle |
|---|---|
| `mobile/` | Appli client (React Native + Expo) |
| `backend/` | API (Node 22 + Fastify + SQLite) et **interface web d'Olivier** sur `/admin` |

## Fonctions

**Côté client (appli iOS / Android, et version web)**
- **Commander sans rien installer** : la même commande fonctionne dans le navigateur (`/commande/`, QR code à imprimer depuis l'admin) ; paiement au retrait pour l'instant sur le web
- **Précommande** jusqu'à N jours à l'avance (réglable), avec choix du jour
- **Remises** affichées avec le **total exact calculé par le serveur** : pizza offerte (fidélité), **offre de bienvenue** sur la 1re commande, **offres heures creuses** sur certains créneaux, **parrainage** (code ami, tampons pour le parrain quand l'ami retire sa 1re commande)
- **Bouton « J'arrive »** (dans 5 / 10 / 15 min, ou « je suis là ») : la cuisine cale la cuisson ; pour les pizzas à régler au retrait, elle peut n'être lancée qu'à ce moment-là (réglage)
- **Suivi de commande visuel** (reçue → acceptée → prête → retirée) avec compte à rebours
- **Infos pratiques** (adresse, appeler, itinéraire, horaires de retrait, fermetures), articles **épuisés aujourd'hui** grisés, filtre **allergènes à éviter**, lien pour laisser un **avis Google**, case **« Recevoir les offres »** (accord du client)
- Carte avec photos, filtre 🌱 végétarien et **allergènes** affichés (quand ils sont renseignés)
- **Pizzas personnalisables** : suppléments payants (1 €), ingrédients à retirer ; tailles et moitié-moitié en option
- **Pizza Duo** à 14 € (demi-pizza au choix + salade chèvre / antipasti / chicken) et formules à prix fixe
- Suggestions au panier (« Un petit extra ? » : boisson, dessert)
- Choix de l'heure de retrait, paiement **en ligne (Stripe) ou au retrait**
- **Carte de fidélité** : 1 pizza retirée = 1 tampon, 10 tampons = 1 pizza offerte (la moins chère du panier)
- **Pizza de la semaine** (avec prix promo facultatif), **best-sellers** 🔥 et **notes des pizzas** ★ données par les clients après le retrait
- **Commander à nouveau** en un clic, suivi de commande en direct
- **Notifications** à chaque étape : commande acceptée, **bientôt prête**, **prête**, « votre pizza vous attend » (si elle n'est pas retirée), annulation, et invitation à noter les pizzas 30 min après le retrait

**Côté Olivier (`/admin`, sur tablette, téléphone ou ordinateur ; installable sur l'écran d'accueil)**
- Commandes en direct (bip à chaque nouvelle commande), détail des options de chaque pizza
- **Régulation du four** : maximum de pizzas par créneau de 15 min (créneau grisé quand il est plein), mode **« rush »** (+10 à +60 min de préparation), bouton **Ouvert / Fermé**
- **Tableau de bord** (onglet *Stats*) : chiffre d'affaires, commandes, panier moyen, pizzas vendues (avec comparaison à la période précédente), courbes par jour, heures de pointe, jours les plus chargés, classement des ventes, nouveaux clients / clients fidèles, paiement en ligne ou au retrait, avis clients
- **Notifications sur son téléphone** (écran installé, *Réglages*) : nouvelle commande, **commande en retard**, **bilan du soir** ; chaque type se coupe séparément
- **Chronomètre de cuisine** : sur chaque commande « à lancer maintenant », « en préparation depuis X min », « en retard de X min », « prête depuis X min »
- **Stats → Cuisine** : temps de préparation typique et « 8 fois sur 10 », selon le nombre de pizzas et selon l'heure, commandes prêtes à l'heure, attente au comptoir, **conseils chiffrés** (délai minimum conseillé, limite de pizzas par créneau) applicables en un clic
- **Offres heures creuses** (remise sur des horaires et jours choisis), **offre de bienvenue**, **parrainage**, **fermetures exceptionnelles** (congés), **commandes à l'avance** et **paiement en ligne obligatoire au-delà d'un montant**, **« J'arrive »** (voir ci-dessus) : tout se règle dans *Réglages*
- **« Épuisé aujourd'hui »** en un clic sur un article ou un supplément (revient seul le lendemain)
- **Ticket de cuisine imprimé** (bouton 🖨 sur chaque commande, ou impression automatique des nouvelles commandes sur la tablette de la cuisine)
- **À prévoir en cuisine** (onglet *Stats*) : pizzas attendues aujourd'hui, demain, après-demain, précommandes comprises, et nombre de pâtons à prévoir
- **QR code et affiches** (*Réglages*) : affiche A4 et planche d'autocollants pour les boîtes à pizza
- **Offres par notification** (onglet *Clients*) : aux seuls clients qui ont accepté, par segment (fidèles, à relancer, nouveaux), une offre tous les 3 jours au plus
- **Fichier clients** (onglet *Clients*, un petit CRM) : recherche, tri, segments (fidèles, nouveaux, **à relancer**), historique et pizza préférée de chaque client, notes privées, export CSV
- **Pizza de la semaine** (onglet *Réglages*) avec prix promo et date de fin
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
**45 jours d'historique de démonstration** pour voir les statistiques et le fichier clients remplis : `npm run demo:history` dans `backend` (sur une base vide ; clients et avis fictifs, **jamais en production**).

### Installer l'écran d'Olivier sur son téléphone
Ouvrir `/admin` dans Chrome (Android) ou Safari (iPhone), puis *Ajouter à l'écran d'accueil* : il s'ouvre ensuite comme une application. Pour le consulter hors du restaurant, le serveur doit être en ligne (HTTPS). Le bip de nouvelle commande ne retentit que quand la page est ouverte ; pour être prévenu **même page fermée**, activer les notifications dans *Réglages* (à faire sur chaque appareil ; elles exigent HTTPS en production et, sur iPhone, l'écran ajouté à l'écran d'accueil, iOS 16.4 ou plus).

### Version web de la commande (sans rien installer)
```bash
cd mobile
npm run build:web      # compile la commande web dans backend/public/commande/
```
Puis ouvrir <http://localhost:3000/> (redirige vers `/commande/`). Dans `/admin` → *Réglages* → *QR code et affiches*, imprimer l'affiche ou les autocollants. À refaire après chaque modification de l'appli. En production, saisir l'adresse publique (https) dans la carte QR.

**Impression automatique des tickets** : sur la tablette de la cuisine, cocher « Imprimer automatiquement… » ; pour supprimer la fenêtre d'impression, lancer Chrome avec `--kiosk-printing` (imprimante par défaut = imprimante de tickets).

### Scénario de test conseillé

1. **Appli** : ouvrir une pizza (ex. Calzone), ajouter un supplément, retirer un ingrédient, l'ajouter ; commander un Pizza Duo ; aller au *Panier* ; accepter une suggestion (boisson/dessert) ; choisir un créneau, saisir prénom et téléphone ; **Envoyer la commande**.
2. **Cuisine** (`/admin`) : la commande apparaît avec un bip (cliquer une fois sur la page pour autoriser le son) et le détail des options. Cliquer **Préparer**, puis **Prête ✓**.
3. **Appli**, onglet *Commande* : le statut avance tout seul (rafraîchi toutes les 5 s).
4. **Cuisine** : cliquer **Retirée**. **Appli**, onglet *Fidélité* : un tampon par pizza apparaît.
5. **Régulation** (`/admin` → *Réglages*) : passer en **Fermé** puis changer d'onglet dans l'appli → « commandes fermées » ; mettre le maximum de pizzas par créneau à 2 et commander 3 pizzas → créneau refusé ; ajouter un message en bannière → il s'affiche en haut de la carte.
6. **Carte** (`/admin` → *Carte*) : changer un prix, masquer un article, ajouter une photo, saisir des allergènes → tirer l'écran de la carte vers le bas dans l'appli pour recharger.
7. **Avis, pizza de la semaine, stats** : passer une commande en *Retirée* dans la cuisine → dans l'appli, onglet *Commande*, noter la pizza ; dans `/admin` → *Réglages*, choisir une pizza de la semaine avec un prix promo → elle apparaît en haut de la carte ; `/admin` → *Stats* et *Clients* pour voir les chiffres.
8. **Chrono et notifications** : dans la cuisine, appuyer sur *Préparer* puis *Prête* → les durées alimentent *Stats → Cuisine* (il faut au moins 10 commandes chronométrées pour avoir des conseils ; `npm run demo:history` en fabrique 289). Les rappels clients (« bientôt prête », « votre pizza vous attend ») partent toutes les 30 s du planificateur du serveur.
9. **Fidélité complète** : mettre 10 pizzas dans une commande, la passer en *Retirée* dans la cuisine → une **pizza offerte** apparaît dans l'appli au prochain panier.

Notes pour le test dans Expo Go :
- **Au retrait** fonctionne directement. Le paiement **en ligne** demande des clés Stripe de test (voir `backend/.env.example`, carte de test `4242 4242 4242 4242`).
- Les **notifications push aux clients** ne fonctionnent pas dans Expo Go sur Android (elles nécessitent un build de l'appli) ; le suivi de commande, lui, se met à jour tout seul dans l'appli. Les **notifications d'Olivier** (écran admin) se testent sur `localhost` dans Chrome : *Réglages → Activer sur cet appareil*.
- Pour repartir de zéro : arrêter le backend et supprimer le dossier `backend/data/`.

## Précisions sur les offres

- **Bienvenue** : désactivée par défaut (`0 €`). « Première commande » = aucune commande valide avec la même carte de fidélité **ou** le même téléphone. Les remises ne se cumulent jamais au-delà du montant de la commande.
- **Parrainage** : activé par défaut (3 tampons pour le parrain), désactivable (`0`). Le filleul profite de l'offre de bienvenue si elle est active.
- **Heures creuses** : la meilleure offre applicable (jour, créneau, commande minimum) est retenue. Elle s'affiche sur les créneaux concernés.
- **« J'arrive » et pizzas à régler au retrait** : réglage désactivé par défaut. Activé, la cuisine voit « en attente du J'arrive » et le client reçoit un rappel 15 min avant le retrait ; une commande ainsi en attente ne déclenche pas d'alerte de retard tant que le client n'a pas répondu.
- **Offres par notification** : réservées aux clients ayant coché « Recevoir les offres » ; accord horodaté en base ; une offre tous les 3 jours maximum. Prévoir la mention correspondante dans la politique de confidentialité.

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
- [ ] **Notifications du patron** : définir `VAPID_SUBJECT` (adresse de contact) et servir le site en HTTPS. Les abonnements des appareils sont conservés dans la base.
- [ ] **Notifications push aux clients** : `eas init` (renseigne `extra.eas.projectId` dans `app.json`) puis configurer les identifiants push (FCM pour Android, APNs pour iOS).
- [ ] **Publication** : comptes développeur Apple (99 €/an) et Google Play (25 € une fois) au nom du restaurant, identifiants d'app `fr.littleitaly.commande` à valider, icône et splash définitifs, puis `eas build` / `eas submit`.
- [ ] Mentions légales et politique de confidentialité (nom et téléphone collectés) : exigées par les stores.
- [ ] Règles de fidélité à valider avec Olivier (10 tampons, 1 tampon par pizza, pizza offerte = la moins chère, formules non éligibles à la pizza offerte).
