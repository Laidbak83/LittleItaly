// Carte réelle de Little Italy, saisie d'après la carte affichée au restaurant.
// Tout est modifiable ensuite dans /admin. À VÉRIFIER par Olivier : prix, descriptions,
// allergènes (laissés vides volontairement : à renseigner par le restaurant).
const TAKEAWAY_PIZZA_CENTS = 1150; // « Pizza à emporter : tarif unique 11,50 € »
const SUPPLEMENT_CENTS = 100; // « Supplément pizza 1,00 € »

// [nom, description (= ingrédients affichés), végétarien]
const PIZZAS = [
  ['Pacino', 'Tomate, fromage, olives, herbes', 1],
  ['Berges', 'Tomate, fromage, chèvre, miel, pignons, herbes', 1],
  ['Scorcese', 'Tomate, fromage, champignons, jambon blanc, herbes', 0],
  ['De Palma', 'Crème fraîche, fromage, chèvre, reblochon, gorgonzola, herbes', 1],
  ['Tarentino', 'Crème fraîche, oignons confits, lardons, champignons, œuf', 0],
  ['Pesci', 'Tomate, fromage, viande hachée, chorizo, oignons confits, œuf, herbes', 0],
  ['Phoenix', 'Tomate, fromage, aubergine, poivrons, courgette, champignons, pesto', 1],
  ['Fraticelli', 'Tomate, fromage, figatelli, chèvre frais', 0],
  ['Pop Toys', 'Crème, fromage, saumon frais, crevettes, pesto', 0],
  ["Soprano's", 'Tomate, fromage, burratina, jambon cru, pesto, roquette', 0],
  ['Calzone', 'Pizza en chausson : tomate, fromage, champignons, jambon blanc, crème fraîche, œuf', 0],
];

// [catégorie, nom, description, prix en centimes, kind, disponible]
const OTHERS = [
  ['Boissons', 'Coca-Cola', '', 350, 'boisson', 1],
  ['Boissons', 'Orangina', '', 350, 'boisson', 1],
  ['Boissons', 'Perrier', '', 350, 'boisson', 1],
  ['Boissons', 'Pago', '', 350, 'boisson', 1],
  ['Boissons', 'Limonade', '', 350, 'boisson', 1],
  ['Boissons', 'Diabolo', '', 350, 'boisson', 1],
  ['Boissons', 'Soda', '', 350, 'boisson', 1],
  ['Boissons', 'Eau plate 50 cl', '', 350, 'boisson', 1],
  ['Boissons', 'Eau gazeuse 50 cl', '', 350, 'boisson', 1],
  ['Boissons', 'Eau plate 1 L', '', 650, 'boisson', 1],
  ['Boissons', 'Eau gazeuse 1 L', '', 650, 'boisson', 1],
  ['Desserts', 'Tiramisu spéculos', '', 660, 'dessert', 1],
  ['Desserts', 'Mousse au chocolat', '', 660, 'dessert', 1],
  ['Desserts', 'Crêpe sucre', '', 300, 'dessert', 1],
  ['Desserts', 'Crêpe Nutella', '', 350, 'dessert', 1],
  ['Desserts', 'Crêpe confiture', '', 350, 'dessert', 1],
  ['Desserts', 'Crêpe miel', '', 350, 'dessert', 1],
  ['Desserts', 'Crêpe Grand Marnier', '', 500, 'dessert', 1],
  ['Desserts', 'Tarte tatin et sa boule vanille', '', 660, 'dessert', 0],
  // Plats et salades : saisis mais masqués, à activer dans /admin si Olivier les vend à emporter.
  ['Plats', 'Lasagne bolognaise', 'Pâte, chair à saucisse, bœuf, sauce tomate, fromage', 1390, 'autre', 0],
  ['Salades', 'Salade chèvre chaud', 'Mesclun, tomates, maïs, jambon cru, toast de chèvre chaud', 1500, 'autre', 0],
  ['Salades', 'Salade César', 'Salade romaine, tomates cerise, poulet pané, croûtons, parmesan, anchois, œuf dur, sauce César', 1650, 'autre', 0],
  ['Salades', 'Salade de poulpe', 'Mesclun, tomates cerise, poulpe mariné à l’huile d’olive, coriandre, crevettes', 1720, 'autre', 0],
  ['Salades', 'Involtini saumon avocat', 'Mesclun, tomates cerise, roulé de saumon fumé, ricotta, crevettes, avocat', 1750, 'autre', 0],
];

const SUPPLEMENTS = ['Œuf', 'Chèvre', 'Jambon blanc', 'Jambon cru', 'Champignons', 'Olives', 'Lardons', 'Chorizo', 'Oignons confits', 'Fromage'];

// « Pizza duo 14 € : choisissez votre demi-pizza et votre salade dessous »
const DUOS = [
  ['Pizza Duo · salade Chèvre', '½ pizza au choix + salade chèvre (mesclun, tomate, maïs, toast de chèvre chaud)'],
  ['Pizza Duo · salade Antipasti', '½ pizza au choix + salade antipasti (mesclun, tomate, aubergines, poivron)'],
  ['Pizza Duo · salade Chicken', '½ pizza au choix + salade chicken (mesclun, tomate, maïs, filet de poulet pané)'],
];

const ingredientsOf = (description) =>
  description
    .replace(/^Pizza en chausson : /, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(',');

export function seedMenu(db) {
  const insert = db.prepare(
    `INSERT INTO menu_items (category, name, description, price_cents, kind, vegetarian, allergens, ingredients, sizes, available, position)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  let pos = 0;
  for (const [name, description, veg] of PIZZAS) {
    insert.run('Pizzas', name, description, TAKEAWAY_PIZZA_CENTS, 'pizza', veg, '', ingredientsOf(description), '[]', 1, pos++);
  }
  for (const [category, name, description, price, kind, available] of OTHERS) {
    insert.run(category, name, description, price, kind, 0, '', '', '[]', available, pos++);
  }
  const sup = db.prepare('INSERT INTO supplements (name, price_cents) VALUES (?,?)');
  SUPPLEMENTS.forEach((name) => sup.run(name, SUPPLEMENT_CENTS));
  const combo = db.prepare('INSERT INTO combos (name, description, price_cents, slots) VALUES (?,?,?,?)');
  DUOS.forEach(([name, description]) => combo.run(name, description, 1400, JSON.stringify(['pizza'])));
}
