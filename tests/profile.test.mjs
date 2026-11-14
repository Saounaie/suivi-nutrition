import test from 'node:test';
import assert from 'node:assert/strict';
import { ageOf, bmr, estimate, weeksToGoal, validateProfile, cleanProfile } from '../js/profile.js';
import { validateState, recentFoods, lastGrams } from '../js/logic.js';

const TODAY = new Date(2026, 10, 14); // 14 novembre 2026
const base = { sex: 'm', birthDate: '1990-06-15', height: 180, activity: 'moderate', goal: 'loss', pace: 0.5 };

test('ageOf : tient compte de l\'anniversaire', () => {
  assert.equal(ageOf('1990-11-14', TODAY), 36);
  assert.equal(ageOf('1990-11-15', TODAY), 35);
  assert.equal(ageOf('1990-06-15', TODAY), 36);
  assert.ok(Number.isNaN(ageOf('nimp', TODAY)));
});

test('bmr : Mifflin-St Jeor, homme et femme', () => {
  assert.equal(bmr({ sex: 'm', weight: 80, height: 180, age: 36 }), 10 * 80 + 6.25 * 180 - 5 * 36 + 5);
  assert.equal(bmr({ sex: 'f', weight: 65, height: 165, age: 30 }), 10 * 65 + 6.25 * 165 - 5 * 30 - 161);
});

test('estimate : perte de poids = dépense moins 550 kcal pour 0,5 kg par semaine', () => {
  const e = estimate(base, 80, TODAY);
  assert.equal(e.age, 36);
  assert.equal(e.bmr, 1750); // 800 + 1125 - 180 + 5
  assert.equal(e.tdee, 2713); // 1750 × 1,55
  assert.equal(e.delta, -550); // 0,5 kg × 7700 / 7, arrondi à 10 kcal
  assert.equal(e.kcal, 2160);
  assert.equal(e.prot, 160); // 2 g/kg
  assert.deepEqual(e.notes, []);
});

test('estimate : maintien et prise de masse', () => {
  const m = estimate({ ...base, goal: 'maintain', pace: null }, 80, TODAY);
  assert.equal(m.delta, 0);
  assert.equal(m.kcal, 2710);
  assert.equal(m.prot, 130); // 1,6 g/kg
  const g = estimate({ ...base, goal: 'gain', pace: 0.25 }, 80, TODAY);
  assert.equal(g.delta, 280); // 275 kcal, arrondi avec le budget à 10 kcal
  assert.equal(g.prot, 145); // 1,8 g/kg
});

test('estimate : plancher de sécurité et déficit plafonné à 25 %', () => {
  const small = { sex: 'f', birthDate: '1980-01-01', height: 155, activity: 'sedentary', goal: 'loss', pace: 0.75 };
  const e = estimate(small, 52, TODAY);
  assert.equal(e.kcal, 1200);
  assert.ok(e.notes.some((n) => n.includes('1200')));
  const big = estimate({ ...base, activity: 'sedentary', pace: 0.75 }, 70, TODAY);
  assert.ok(big.kcal >= Math.round(big.tdee * 0.75 / 10) * 10 - 10);
  assert.ok(big.delta >= -Math.round(big.tdee * 0.25) - 1);
});

test('weeksToGoal : sens cohérent avec l\'objectif', () => {
  assert.equal(weeksToGoal(base, 80, 75), 10);
  assert.equal(weeksToGoal(base, 80, 85), null); // perte demandée mais cible plus haute
  assert.equal(weeksToGoal({ ...base, goal: 'gain', pace: 0.25 }, 70, 72), 8);
  assert.equal(weeksToGoal({ ...base, goal: 'maintain', pace: null }, 80, 80), null);
});

test('validateProfile : refuse les profils incomplets ou invraisemblables', () => {
  assert.equal(validateProfile(base, TODAY), null);
  assert.ok(validateProfile({ ...base, sex: null }, TODAY));
  assert.ok(validateProfile({ ...base, height: 90 }, TODAY));
  assert.ok(validateProfile({ ...base, birthDate: '2020-01-01' }, TODAY));
  assert.ok(validateProfile({ ...base, activity: 'zzz' }, TODAY));
  assert.ok(validateProfile({ ...base, goal: 'gain', pace: 0.75 }, TODAY)); // 0,75 n'existe pas en prise
  assert.equal(validateProfile({ ...base, goal: 'maintain', pace: null }, TODAY), null);
});

test('cleanProfile : nettoie ou renvoie null', () => {
  assert.equal(cleanProfile(null), null);
  assert.equal(cleanProfile({ sex: 'x' }), null);
  assert.deepEqual(cleanProfile({ ...base, height: '180', extra: 1 }), base);
  assert.equal(cleanProfile({ ...base, goal: 'maintain', pace: 0.5 }).pace, null);
});

test('validateState : profil, repas enregistrés et accueil', () => {
  const s = validateState({
    v: 1, foods: [], entries: [], settings: { onboarded: true }, profile: base,
    meals: [{ id: 'm1', name: 'Petit-déj', items: [{ foodId: 'a', grams: '60' }, { foodId: 'b', grams: 0 }, { foodId: '', grams: 10 }] }, { id: 'm2', name: 'Vide', items: [] }, { id: '', name: 'Sans id', items: [{ foodId: 'a', grams: 1 }] }],
  });
  assert.equal(s.settings.onboarded, true);
  assert.deepEqual(s.profile, base);
  assert.deepEqual(s.meals, [{ id: 'm1', name: 'Petit-déj', items: [{ foodId: 'a', grams: 60 }] }]);
  const old = validateState({ v: 1, foods: [], entries: [] });
  assert.equal(old.settings.onboarded, false); // ancien fichier : l'écran de bienvenue s'affichera une fois
  assert.equal(old.profile, null);
  assert.deepEqual(old.meals, []);
});

test('recentFoods : les plus utilisés sur 30 jours, puis les plus récents', () => {
  const foods = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id }));
  const e = (date, foodId) => ({ date, foodId, grams: 10 });
  const entries = [e('2026-11-10', 'a'), e('2026-11-11', 'b'), e('2026-11-12', 'b'), e('2026-11-13', 'c'), e('2026-11-13', 'a'), e('2026-09-01', 'd'), { date: '2026-11-13', foodId: null }, e('2026-11-13', 'supprime')];
  assert.deepEqual(recentFoods(entries, foods, '2026-11-14').map((f) => f.id), ['a', 'b', 'c']); // a et b : 2 usages chacun, a est le plus récent
  assert.deepEqual(recentFoods(entries, foods, '2026-11-14', 1).length, 1);
});

test('lastGrams : dernière quantité utilisée', () => {
  const entries = [{ date: '2026-11-10', foodId: 'a', grams: 100 }, { date: '2026-11-12', foodId: 'a', grams: 150 }, { date: '2026-11-11', foodId: 'b', grams: 20 }];
  assert.equal(lastGrams(entries, 'a'), 150);
  assert.equal(lastGrams(entries, 'zzz'), null);
});
