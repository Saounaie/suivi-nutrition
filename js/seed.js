// Produits habituels déjà vérifiés avec Jérôme. null = valeur inconnue (à compléter), comptée 0 dans les totaux.
const f = (name, brand, kcal, prot, carbs, sugars, fat, fiber, portions = [], note = '') => ({
  name, brand, barcode: '', source: 'manual', note,
  per100: { kcal, prot, carbs, sugars, fat, fiber }, portions,
});

export const SEED_FOODS = [
  f('Skyr nature 0 %', 'Danone', 57, 10, null, null, null, null, [{ name: 'Ma dose', grams: 200 }], 'kcal et protéines vérifiées'),
  f('Frites au four', "Pom'lisse (Marque Repère)", 123, null, null, null, null, null, [{ name: 'Portion', grams: 200 }], 'kcal du paquet vérifiées, reste à compléter'),
  f('Blanc de poulet (tranches fines)', 'Tradilège (Marque Repère)', 109, null, null, null, null, null, [{ name: '1 tranche', grams: 30 }], 'kcal vérifiées, tranche estimée à 30 g : à peser une fois'),
  f('Lardons', 'Tradilège', 248, null, null, null, null, null, [{ name: 'Portion', grams: 55 }], 'kcal vérifiées'),
  f('Pita', 'La Boulangère', 258, null, null, null, null, null, [{ name: '1 pita', grams: 80 }], '206 kcal le pita de 80 g'),
  f('Sandwich poulet crudités XXL', 'Daunat', 224, 8.3, 26, null, 8.8, null, [{ name: '1 sandwich', grams: 230 }], '≈ 515 kcal / 19 g de protéines le sandwich'),
  f('Flocons d\'avoine', 'Grainéa', null, null, null, null, null, null, [{ name: 'Ma dose', grams: 30 }], 'valeurs à saisir depuis le paquet'),
  f('Œuf', '', null, null, null, null, null, null, [{ name: '1 œuf', grams: 60 }], '≈ 90 kcal / 7 g de protéines la pièce : valeurs /100 g à saisir'),
];
