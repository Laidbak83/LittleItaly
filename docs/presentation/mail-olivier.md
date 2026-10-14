**Objet : Little Italy – votre appli de commande de pizzas à emporter (première version)**

*Pièces jointes : apercu-appli.png, cuisine-commandes.png, dashboard-olivier.png*

Bonjour Olivier,

Comme convenu, voici la première version de l'application **Little Italy** pour vos pizzas à emporter. Elle fonctionne déjà de bout en bout en **version de démonstration** (sur ordinateur et simulateur de téléphone). Elle n'est pas encore publiée sur l'App Store ni sur Google Play.

**L'idée en une phrase :** vos clients commandent leur pizza depuis leur téléphone, choisissent l'heure de retrait, et la commande arrive directement en cuisine : plus d'appel à décrocher, plus d'erreur de commande.

### Ce que voient vos clients (voir l'image « apercu-appli »)
- **Votre carte**, avec les 11 pizzas au tarif unique emporté de **11,50 €**, les 3 **Pizza Duo à 14 €**, les boissons et les desserts
- **La personnalisation** : suppléments à 1 €, ingrédients à retirer
- **Le choix de l'heure de retrait**, selon vos horaires
- **Le paiement en ligne ou au retrait**
- **Le suivi de la commande** : reçue, en préparation, prête (avec une notification quand elle est prête)
- **Une carte de fidélité** : 10 pizzas retirées = la suivante offerte
- **La pizza de la semaine**, mise en avant en haut de la carte (avec un prix promo si vous le souhaitez)
- **Les plus commandées** (best-sellers) et **la note des pizzas**, données par les clients après le retrait
- **« Commander à nouveau »** en un seul geste

### Ce que vous voyez en cuisine (voir l'image « cuisine-commandes »)
- Un écran (tablette, téléphone ou ordinateur) avec les commandes **classées par heure de retrait**, le détail des pizzas, les remarques du client, le montant et « payé » ou « à encaisser »
- Un **bip à chaque nouvelle commande**
- Trois boutons : **Préparer, Prête, Retirée**. Le client est prévenu automatiquement.
- Vous gardez la main, sans développeur :
  - un bouton **Ouvert / Fermé** pour couper les commandes quand vous êtes débordé ou fermé ;
  - une **limite de pizzas par créneau de 15 minutes**, pour ne pas être submergé ;
  - un mode **« rush »** qui rallonge le délai de préparation ;
  - un **message en haut de l'appli** (pizza du moment, promo, congés) ;
  - la modification des **prix**, des **photos**, des articles disponibles, des suppléments et des formules.

### Votre tableau de bord, même quand vous n'êtes pas au restaurant (voir l'image « dashboard-olivier », chiffres de démonstration)
- **Chiffre d'affaires, nombre de commandes, panier moyen, pizzas vendues**, avec la comparaison à la période précédente
- **Courbes** : chiffre d'affaires par jour, heures de pointe, jours les plus chargés
- **Les pizzas les plus vendues et les mieux notées**, et les avis laissés par les clients
- **Un fichier clients** : historique de commandes, pizza préférée, clients « à relancer », notes privées (allergies, habitudes), export Excel
- Il s'installe sur l'écran d'accueil du téléphone comme une application. Pour le consulter hors du restaurant, le serveur doit être en ligne, ce qui sera le cas à la mise en production.

### Ce dont j'ai besoin de vous
1. **Valider la carte.** J'ai repris celle affichée au restaurant (prix, descriptions). Merci de relire, et de me dire si la liste des suppléments à 1 € vous convient.
2. **Les allergènes** de chaque plat : je n'ai rien inventé, c'est à vous de les indiquer.
3. **Les horaires de retrait des pizzas.** J'ai supposé qu'on peut commander à partir de 11h30 et jusqu'à la fermeture (19h du lundi au mercredi, 22h du jeudi au samedi, 15h le dimanche, pas de pizza le dimanche soir). À confirmer.
4. **Votre logo** et **quelques belles photos de vos pizzas**, pour que l'appli et les affiches soient à votre image.

### Points à trancher ensemble
- **Si un client choisit « payer au retrait » et ne vient pas ?** Quelques pistes simples : un statut « non retirée » ; au bout de deux oublis, ce client devra payer en ligne ; un signal rouge en cuisine quand une commande attend depuis trop longtemps ; le paiement en ligne obligatoire au-delà d'un certain montant. Qu'est-ce qui vous semble raisonnable ?
- **Un compte client ?** Pour l'instant, pas besoin de compte : le client commande en quelques secondes et sa carte de fidélité reste sur son téléphone. Plus tard, on pourra proposer un compte facultatif (avec le numéro de téléphone) pour retrouver sa fidélité sur un nouveau téléphone.
- **Vendre aussi des plats à emporter** (lasagne, pâtes, salades) ? Je les ai déjà saisis, masqués pour l'instant. Pour les pâtes (choix de la sauce) ou la viande (cuisson, accompagnement), il faudra ajouter des options : c'est faisable dans un second temps.
- **Le paiement en ligne** : souhaitez-vous le proposer dès le début ? Cela demande un compte Stripe au nom du restaurant et une petite commission sur chaque paiement en ligne.

### Les étapes suivantes
1. Vous validez les points ci-dessus.
2. Je termine l'identité visuelle (logo, couleurs, icône de l'appli).
3. Je mets le serveur en ligne et je publie l'appli. Il faut pour cela un compte développeur Apple (environ 99 €/an) et un compte Google Play (environ 25 € une fois), au nom du restaurant.
4. Lancement : autocollants et QR codes sur les boîtes à pizza, affichettes au comptoir. Les panneaux 4×3 au bord de la route viendront ensuite, une fois que tout fonctionne (et sous réserve de l'autorisation de la mairie).

Je peux vous faire une **démonstration sur place**, avec un téléphone, quand cela vous arrange.

Cordialement,
[Votre prénom]
