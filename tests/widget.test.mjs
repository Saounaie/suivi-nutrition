import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Le script est écrit pour Scriptable (pas un module) : on l'exécute avec un faux environnement pour tester ses fonctions pures.
const sandbox = { module: { exports: {} }, Color: class {} };
vm.runInNewContext(fs.readFileSync(new URL('../widget/suivi-widget.js', import.meta.url), 'utf8'), sandbox);
const { summarize, isoOf } = sandbox.module.exports;

const state = {
  settings: { kcal: 2000, prot: 120, goalWeight: 80 },
  entries: [
    { date: '2026-11-14', kcal: 500, prot: 30, carbs: 60, fat: 10 },
    { date: '2026-11-14', kcal: 700.4, prot: 40.4, carbs: 80, fat: 20 },
    { date: '2026-11-13', kcal: 1900, prot: 100, carbs: 200, fat: 60 },
  ],
  body: [{ date: '2026-11-01', weight: 90 }, { date: '2026-11-10', weight: 88.5, waist: 99 }, { date: '2026-11-12', weight: null, waist: 98 }],
  syncedAt: '2026-11-14T10:00:00.000Z',
};

test('widget : résumé de la journée', () => {
  const s = summarize(state, '2026-11-14');
  assert.equal(s.kcal, 1200);
  assert.equal(s.left, 800);
  assert.equal(s.prot, 70);
  assert.equal(s.carbs, 140);
  assert.equal(s.fat, 30);
  assert.ok(Math.abs(s.pct - 0.6) < 0.001);
  assert.equal(s.weight, 88.5);
  assert.equal(s.goal, 80);
});

test('widget : dépassement, journée vide et état minimal', () => {
  assert.equal(summarize(state, '2026-11-13').left, 100);
  assert.equal(summarize({ ...state, settings: { kcal: 1000, prot: 100 } }, '2026-11-14').left, -200);
  const empty = summarize({}, '2026-11-14');
  assert.deepEqual([empty.kcal, empty.left, empty.budget, empty.weight], [0, 1900, 1900, null]);
});

test('widget : isoOf formate la date locale', () => assert.equal(isoOf(new Date(2026, 10, 4)), '2026-11-04'));
