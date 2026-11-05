import test from 'node:test';
import assert from 'node:assert/strict';
import { macrosFor, totals, remaining, parseNumber, shiftDate, searchFoods, validateState, mealOfHour, dayStatus, weekOf, reconcileEntries, addStock, deductStock, stockOf, daysLeft, normalizeBarcode, findByBarcode, mapOffProduct } from '../js/logic.js';

test('macrosFor : 150 g de poulet à 110 kcal / 23 g prot', () => {
  const m = macrosFor({ kcal: 110, prot: 23 }, 150);
  assert.equal(m.kcal, 165);
  assert.equal(m.prot, 34.5);
});

test('macrosFor : valeur absente comptée comme 0', () => {
  assert.equal(macrosFor({ kcal: 123, prot: null }, 200).prot, 0);
  assert.equal(macrosFor({ kcal: 123 }, 200).kcal, 246);
});

test('totals et remaining', () => {
  const e = [{ kcal: 259, prot: 24 }, { kcal: 600, prot: 22 }];
  assert.equal(totals(e).kcal, 859);
  assert.equal(totals(e).prot, 46);
  assert.equal(remaining(1900, e), 1041);
  assert.equal(remaining(1900, []), 1900);
});

test('parseNumber accepte la virgule', () => {
  assert.equal(parseNumber('3,9'), 3.9);
  assert.equal(parseNumber(' '), null);
  assert.ok(Number.isNaN(parseNumber('abc')));
  assert.ok(Number.isNaN(parseNumber('-2')));
});

test('shiftDate passe les fins de mois', () => {
  assert.equal(shiftDate('2026-11-30', 1), '2026-12-01');
  assert.equal(shiftDate('2026-11-01', -1), '2026-10-31');
});

test('searchFoods ignore accents et casse, cherche aussi le code-barres', () => {
  const foods = [{ name: 'Œufs', brand: '' }, { name: 'Escalope de poulet', brand: '', barcode: '123' }, { name: 'Frites', brand: "Pom'lisse" }];
  assert.equal(searchFoods(foods, 'ESCALOPE')[0].name, 'Escalope de poulet');
  assert.equal(searchFoods(foods, 'pomlisse').length, 0);
  assert.equal(searchFoods(foods, 'pom').length, 1);
  assert.equal(searchFoods(foods, '123').length, 1);
});

test('validateState refuse un fichier inconnu et nettoie un fichier valide', () => {
  assert.throws(() => validateState({}));
  assert.throws(() => validateState(null));
  const s = validateState({ v: 1, foods: [{ id: 'a', name: 'X', per100: { kcal: '57', prot: 'zzz' }, portions: [{ name: 'p', grams: 0 }] }], entries: [{ id: 'e', date: 'nimp', meal: 'xx', kcal: 10 }], settings: { theme: 'neon' } });
  assert.equal(s.foods[0].per100.kcal, 57);
  assert.equal(s.foods[0].per100.prot, null);
  assert.equal(s.foods[0].portions.length, 0);
  assert.equal(s.entries[0].meal, 'collation');
  assert.equal(s.settings.theme, 'dark');
  assert.equal(s.settings.kcal, 1900);
});

test('mealOfHour', () => {
  assert.equal(mealOfHour(8), 'petit-dej');
  assert.equal(mealOfHour(12), 'dejeuner');
  assert.equal(mealOfHour(20), 'diner');
});

test('dayStatus', () => {
  assert.equal(dayStatus(0, 1900, true), 'empty');
  assert.equal(dayStatus(1850, 1900, true), 'ok');
  assert.equal(dayStatus(1000, 1900, false), 'ok');
  assert.equal(dayStatus(1000, 1900, true), 'low');
  assert.equal(dayStatus(1950, 1900, false), 'high');
  assert.equal(dayStatus(2200, 1900, false), 'over');
});

test('weekOf : lundi à dimanche', () => {
  const w = weekOf('2026-11-05');
  assert.equal(w[0], '2026-11-02');
  assert.equal(w[6], '2026-11-08');
  assert.equal(weekOf('2026-11-08')[0], '2026-11-02');
  assert.equal(weekOf('2026-11-02')[0], '2026-11-02');
});

test('reconcileEntries : la modification d\'un aliment met à jour ses repas', () => {
  const foods = [{ id: 'f1', name: 'Skyr', per100: { kcal: 57, prot: 12 } }];
  const entries = [
    { id: 'a', foodId: 'f1', label: 'Skyr', grams: 200, kcal: 114, prot: 20, carbs: 0, sugars: 0, fat: 0, fiber: 0 },
    { id: 'b', foodId: null, label: 'Cantine', grams: null, kcal: 600, prot: 22, carbs: 0, sugars: 0, fat: 0, fiber: 0 },
    { id: 'c', foodId: 'supprime', label: 'Ancien', grams: 100, kcal: 80, prot: 5, carbs: 0, sugars: 0, fat: 0, fiber: 0 },
  ];
  assert.equal(reconcileEntries(entries, foods), 1);
  assert.equal(entries[0].prot, 24);
  assert.equal(entries[1].kcal, 600);
  assert.equal(entries[2].kcal, 80);
  assert.equal(reconcileEntries(entries, foods), 0);
});

test('addStock fusionne par aliment et zone, garde la DLC la plus proche', () => {
  const st = [];
  addStock(st, { foodId: 'a', grams: 500, zone: 'frigo', dlc: '2026-11-10' });
  addStock(st, { foodId: 'a', grams: 250, zone: 'frigo', dlc: '2026-11-08' });
  addStock(st, { foodId: 'a', grams: 1000, zone: 'congel' });
  assert.equal(st.length, 2);
  assert.equal(st[0].grams, 750);
  assert.equal(st[0].dlc, '2026-11-08');
  assert.equal(stockOf(st, 'a'), 1750);
});

test('deductStock : frigo avant congélateur, supprime les lignes vides, signale le manque', () => {
  const st = [];
  addStock(st, { foodId: 'a', grams: 100, zone: 'congel' });
  addStock(st, { foodId: 'a', grams: 150, zone: 'frigo' });
  let r = deductStock(st, 'a', 200);
  assert.deepEqual(r, { deducted: 200, short: 0 });
  assert.equal(st.find((x) => x.zone === 'frigo'), undefined);
  assert.equal(st[0].grams, 50);
  r = deductStock(st, 'a', 80);
  assert.deepEqual(r, { deducted: 50, short: 30 });
  assert.equal(st.length, 0);
  assert.deepEqual(deductStock(st, 'zzz', 10), { deducted: 0, short: 10 });
});

test('daysLeft', () => {
  assert.equal(daysLeft('2026-11-07', '2026-11-05'), 2);
  assert.equal(daysLeft('2026-11-04', '2026-11-05'), -1);
  assert.equal(daysLeft(null, '2026-11-05'), null);
});

test('validateState garde le stock valide et écarte les lignes orphelines', () => {
  const s = validateState({ v: 1, foods: [{ id: 'a', name: 'X' }], entries: [], stock: [{ id: '1', foodId: 'a', grams: 300, zone: 'bizarre', dlc: 'x' }, { id: '2', foodId: 'inconnu', grams: 10 }, { id: '3', foodId: 'a', grams: 0 }] });
  assert.equal(s.stock.length, 1);
  assert.equal(s.stock[0].zone, 'frigo');
  assert.equal(s.stock[0].dlc, null);
  assert.equal(validateState({ v: 1, foods: [], entries: [] }).stock.length, 0);
});

test('normalizeBarcode et findByBarcode (UPC-A = EAN-13 avec 0)', () => {
  assert.equal(normalizeBarcode(' 3033 4912-70383 '), '303349127038 3'.replace(' ', ''));
  assert.equal(normalizeBarcode('036000291452'), '0036000291452');
  const foods = [{ id: 'a', barcode: '0036000291452' }, { id: 'b', barcode: '' }];
  assert.equal(findByBarcode(foods, '036000291452').id, 'a');
  assert.equal(findByBarcode(foods, ''), null);
  assert.equal(findByBarcode(foods, '999'), null);
});

test('mapOffProduct : produit complet', () => {
  const r = mapOffProduct({ status: 1, product: { product_name: 'Skyr', brands: 'Danone, Autre', serving_quantity: 150, product_quantity: '450', nutriments: { 'energy-kcal_100g': 57, proteins_100g: 10.1, carbohydrates_100g: 3.9, sugars_100g: 3.9, fat_100g: 0.2, fiber_100g: 0 } } }, '3033491270383');
  assert.equal(r.name, 'Skyr');
  assert.equal(r.brand, 'Danone');
  assert.equal(r.per100.kcal, 57);
  assert.equal(r.per100.prot, 10.1);
  assert.equal(r.per100.fiber, 0);
  assert.deepEqual(r.portions.map((p) => p.grams), [150, 450]);
  assert.equal(r.source, 'off');
});

test('mapOffProduct : kJ converti, valeurs absentes = null, produit absent = null', () => {
  const r = mapOffProduct({ status: 1, product: { product_name: 'X', nutriments: { energy_100g: 418.4, proteins_100g: '5' } } }, '123');
  assert.equal(r.per100.kcal, 100);
  assert.equal(r.per100.fat, null);
  assert.equal(mapOffProduct({ status: 0 }, '1'), null);
  assert.equal(mapOffProduct({ status: 1, product: { product_name: 'Vide', nutriments: {} } }, '1'), null);
  assert.equal(mapOffProduct(null, '1'), null);
});
