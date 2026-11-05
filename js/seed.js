// L'appli ne pré-remplit plus aucun aliment. Cette liste sert uniquement à reconnaître les aliments
// d'exemple créés par les premières versions, pour proposer de les supprimer (Aliments > Nettoyer).
const SEEDS = [
  ['Skyr nature 0 %', 'Danone'],
  ['Frites au four', "Pom'lisse (Marque Repère)"],
  ['Blanc de poulet (tranches fines)', 'Tradilège (Marque Repère)'],
  ['Lardons', 'Tradilège'],
  ['Pita', 'La Boulangère'],
  ['Sandwich poulet crudités XXL', 'Daunat'],
  ["Flocons d'avoine", 'Grainéa'],
  ['Œuf', ''],
];

export function isSeedFood(f) {
  return !f.barcode && SEEDS.some(([n, b]) => f.name === n && (f.brand || '') === b);
}
