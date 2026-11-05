import test from 'node:test';
import assert from 'node:assert/strict';
import { macrosFor, totals, remaining, parseNumber, shiftDate, searchFoods, validateState, mealOfHour, dayStatus, weekOf } from '../js/logic.js';

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
