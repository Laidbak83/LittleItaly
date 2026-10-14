// Carte de test indépendante de la vraie carte (src/seed.js) : les tests ne cassent pas
// quand Olivier change ses prix. ids : 1-6 pizzas, 7-8 boissons, 9 dessert.
const NORMAL_GRANDE = JSON.stringify([
  { label: 'Normale', extra_cents: 0 },
  { label: 'Grande', extra_cents: 400 },
]);
const MENU = [
  ['Pizzas', 'Margherita', 'Tomate, mozzarella, basilic', 900, 'pizza', 1, 'gluten,lait', 'Tomate,Mozzarella,Basilic', NORMAL_GRANDE],
  ['Pizzas', 'Reine', 'Tomate, mozzarella, jambon, champignons', 1100, 'pizza', 0, 'gluten,lait', 'Tomate,Mozzarella,Jambon,Champignons', NORMAL_GRANDE],
  ['Pizzas', 'Regina', 'Tomate, mozzarella, jambon, olives', 1100, 'pizza', 0, 'gluten,lait', 'Tomate,Mozzarella,Jambon,Olives', NORMAL_GRANDE],
  ['Pizzas', 'Calzone', 'Tomate, mozzarella, jambon, œuf', 1200, 'pizza', 0, 'gluten,lait,œufs', 'Tomate,Mozzarella,Jambon,Œuf', NORMAL_GRANDE],
  ['Pizzas', '4 fromages', 'Mozzarella, gorgonzola, chèvre, parmesan', 1300, 'pizza', 1, 'gluten,lait', 'Mozzarella,Gorgonzola,Chèvre,Parmesan', NORMAL_GRANDE],
  ['Pizzas', 'Diavola', 'Tomate, mozzarella, chorizo piquant', 1250, 'pizza', 0, 'gluten,lait', 'Tomate,Mozzarella,Chorizo piquant', NORMAL_GRANDE],
  ['Boissons', 'Coca-Cola 33cl', '', 300, 'boisson', 1, '', '', '[]'],
  ['Boissons', 'Eau minérale 50cl', '', 200, 'boisson', 1, '', '', '[]'],
  ['Desserts', 'Tiramisu', 'Fait maison', 450, 'dessert', 1, 'gluten,lait,œufs', '', '[]'],
];

export function seedFixture(db) {
  const item = db.prepare(
    `INSERT INTO menu_items (category, name, description, price_cents, kind, vegetarian, allergens, ingredients, sizes, position)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  MENU.forEach((row, i) => item.run(...row, i));
  const sup = db.prepare('INSERT INTO supplements (name, price_cents) VALUES (?,?)');
  [['Œuf', 100], ['Chèvre', 150], ['Jambon', 150], ['Chorizo', 150], ['Champignons', 100], ['Olives', 100]].forEach((r) => sup.run(...r));
  const combo = db.prepare('INSERT INTO combos (name, description, price_cents, slots) VALUES (?,?,?,?)');
  combo.run('Formule Midi', 'Une pizza + une boisson', 1100, JSON.stringify(['pizza', 'boisson']));
  combo.run('Formule Duo', 'Une pizza + une boisson + un dessert', 1400, JSON.stringify(['pizza', 'boisson', 'dessert']));
  return db;
}
