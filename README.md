# Little Italy – commande de pizzas à emporter

Application iOS / Android pour le restaurant Little Italy (Trans-en-Provence).

| Dossier | Rôle |
|---|---|
| `mobile/` | Appli client (React Native + Expo) : carte, panier, choix de l'heure de retrait, paiement en ligne ou au retrait, suivi de commande, notification « commande prête » |
| `backend/` | API (Node 22 + Fastify + SQLite) et **interface web d'Olivier** sur `/admin` : commandes en direct (son à chaque nouvelle commande), changement de statut, modification de la carte et des prix |

## Lancer en local

```bash
# 1. Backend
cd backend
cp .env.example .env        # puis renseigner ADMIN_TOKEN
npm install
ADMIN_TOKEN=monCode npm start   # http://localhost:3000/admin
npm test

# 2. Appli mobile
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://<IP-de-votre-PC>:3000 npx expo start   # scanner avec Expo Go
```

## Fonctionnement

1. Le client compose son panier et choisit un créneau (aujourd'hui, par pas de 15 min, 20 min minimum de préparation).
2. **Au retrait** : la commande arrive tout de suite chez Olivier. **En ligne** (Stripe) : elle n'apparaît qu'une fois le paiement confirmé par le webhook.
3. Olivier la passe en *En préparation* puis *Prête* : le client reçoit une notification push et voit l'avancement dans l'appli.

Les prix sont toujours recalculés côté serveur.

## À faire avant la mise en production

- [ ] **Carte** : la carte fournie est un exemple. La remplacer dans `/admin` → *Carte*.
- [ ] **Horaires et jours de fermeture** : `backend/src/config.js` (valeurs actuelles = hypothèses).
- [ ] **Hébergement du backend** (accessible en HTTPS) et `ADMIN_TOKEN` fort. La base SQLite est dans `DB_PATH` : prévoir un volume persistant et des sauvegardes.
- [ ] **Stripe** : compte du restaurant, clés dans `.env`, webhook `payment_intent.succeeded` → `https://<serveur>/api/stripe/webhook`. Pour Apple Pay, ajouter `merchantIdentifier` dans le plugin Stripe de `mobile/app.json`.
- [ ] **Notifications push** : `eas init` (renseigne `extra.eas.projectId` dans `app.json`) puis configurer les identifiants push (FCM pour Android, APNs pour iOS).
- [ ] **Publication** : comptes développeur Apple (99 €/an) et Google Play (25 € une fois) au nom du restaurant, identifiants d'app `fr.littleitaly.commande` à valider, icône et splash définitifs, puis `eas build` / `eas submit`.
- [ ] Mentions légales, politique de confidentialité (le nom et le téléphone sont collectés) : exigées par les stores.
