import test from 'node:test';
import assert from 'node:assert/strict';
import { validateState, shiftDate, weekOf } from '../js/logic.js';
import { streaks, computeStats, TROPHIES, unlockedTrophies, trophyProgress, levelOf, LEVELS, MESSAGES, pickMessage, seedOf, situation, weekRecap, goalKey } from '../js/motivation.js';

const MON = '2026-11-09'; // un lundi
const entry = (date, kcal = 1800, prot = 120, extra = {}) => ({ id: date + kcal, date, meal: 'dejeuner', label: 'x', kcal, prot, carbs: 0, sugars: 0, fat: 0, fiber: 0, ...extra });
const mkState = (over = {}) => ({
  settings: { kcal: 1900, prot: 115, goalWeight: null, goalStart: null, tone: 'mix' },
  foods: [], entries: [], stock: [], body: [], trophies: {}, ...over,
});

test('le lundi de test est bien un lundi', () => assert.equal(weekOf(MON)[0], MON));

test('streaks : jours consécutifs sans trou', () => {
  const good = new Set(['2026-11-09', '2026-11-10', '2026-11-11']);
  const r = streaks((d) => good.has(d), MON, '2026-11-11');
  assert.equal(r.current, 3);
  assert.equal(r.best, 3);
});

test('streaks : un joker par semaine absorbe un jour raté', () => {
  const good = new Set(['2026-11-09', '2026-11-10', '2026-11-12', '2026-11-13']); // le 11 est raté
  const r = streaks((d) => good.has(d), MON, '2026-11-13');
  assert.equal(r.current, 4);
  assert.equal(r.jokerLeft, false);
});

test('streaks : deux jours ratés dans la même semaine cassent la série', () => {
  const good = new Set(['2026-11-09', '2026-11-10', '2026-11-13']); // 11 et 12 ratés
  const r = streaks((d) => good.has(d), MON, '2026-11-13');
  assert.equal(r.current, 1);
  assert.equal(r.best, 2);
});

test('streaks : le joker se renouvelle la semaine suivante', () => {
  const miss = new Set(['2026-11-11', '2026-11-18']);
  const r = streaks((d) => !miss.has(d), MON, '2026-11-20');
  assert.equal(r.current, 10);
  assert.equal(r.best, 10);
});

test('streaks : un trou sans série en cours ne consomme pas de joker', () => {
  const r = streaks((d) => d >= '2026-11-11', MON, '2026-11-12', '2026-11-12');
  assert.equal(r.current, 2);
  assert.equal(r.jokerLeft, true);
});

test('computeStats : état vide', () => {
  const s = computeStats(mkState(), '2026-11-13');
  assert.equal(s.meals, 0);
  assert.equal(s.log.current, 0);
  assert.equal(s.curAvg, null);
  assert.deepEqual(unlockedTrophies(s), []);
});

test('computeStats : la série de suivi tient tant qu\'aujourd\'hui n\'est pas fini', () => {
  const st = mkState({ entries: [entry('2026-11-11'), entry('2026-11-12')] });
  assert.equal(computeStats(st, '2026-11-13').log.current, 2); // aujourd'hui encore vide : pas de rupture
  assert.equal(computeStats(st, '2026-11-13').daysAway, 1);
  st.entries.push(entry('2026-11-13'));
  assert.equal(computeStats(st, '2026-11-13').log.current, 3);
});

test('computeStats : série dans le budget sur les jours terminés seulement', () => {
  const st = mkState({ entries: [entry('2026-11-11', 1800), entry('2026-11-12', 1850), entry('2026-11-13', 1700)] });
  const s = computeStats(st, '2026-11-13');
  assert.equal(s.budget.current, 2);
  assert.equal(s.okDays, 2);
});

test('trophées : premier repas, protéines, fibres', () => {
  const st = mkState({ entries: [entry('2026-11-12', 1800, 120, { fiber: 31 })] });
  const ids = unlockedTrophies(computeStats(st, '2026-11-13'));
  for (const id of ['first-meal', 'ok1', 'prot1', 'fiber']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('log3'));
});

test('trophées : semaine solide = 5 jours dans le budget sur une même semaine', () => {
  const entries = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((d) => entry(d, 1800));
  const s = computeStats(mkState({ entries }), '2026-11-15');
  assert.equal(s.solidWeek, 5);
  const ids = unlockedTrophies(s);
  assert.ok(ids.includes('solid-week'));
  assert.ok(ids.includes('log3') && ids.includes('log7') === false);
});

test('trophées : perte de poids calculée sur la moyenne mobile', () => {
  const body = [
    { id: 'a', date: '2026-11-01', weight: 90, waist: 100 },
    { id: 'b', date: '2026-11-08', weight: 89, waist: 98.5 },
    { id: 'c', date: '2026-11-15', weight: 88, waist: null },
    { id: 'd', date: '2026-11-22', weight: 87, waist: null },
  ];
  const s = computeStats(mkState({ body }), '2026-11-22');
  assert.equal(s.startWeight, 90);
  assert.equal(s.lost, 3); // pesées espacées de 7 j : la moyenne de 7 jours vaut la dernière pesée
  assert.equal(s.waistLost, 1.5);
  const ids = unlockedTrophies(s);
  assert.ok(ids.includes('lose1') && ids.includes('lose2') && !ids.includes('lose5'));
  assert.ok(ids.includes('weigh1') && ids.includes('waist1') && ids.includes('weigh4'));
});

test('objectif : progression, mi-chemin et atteint', () => {
  const body = [{ id: 'a', date: '2026-11-01', weight: 90 }, { id: 'b', date: '2026-11-20', weight: 85 }];
  const st = mkState({ body });
  st.settings.goalWeight = 80;
  let s = computeStats(st, '2026-11-20');
  assert.equal(s.goal, 80);
  assert.equal(s.goalFrac, 0.5);
  assert.ok(unlockedTrophies(s).includes('goal-half'));
  assert.ok(!unlockedTrophies(s).includes('goal-done'));
  st.body.push({ id: 'c', date: '2026-12-01', weight: 79.5 });
  s = computeStats(st, '2026-12-01');
  assert.equal(s.goalFrac, 1);
  assert.ok(unlockedTrophies(s).includes('goal-done'));
});

test('objectif : un poids cible supérieur au départ est ignoré', () => {
  const st = mkState({ body: [{ id: 'a', date: '2026-11-01', weight: 80 }] });
  st.settings.goalWeight = 85;
  const s = computeStats(st, '2026-11-02');
  assert.equal(s.goal, null);
  assert.equal(s.goalFrac, 0);
});

test('objectif : le poids de départ saisi remplace la première pesée', () => {
  const st = mkState({ body: [{ id: 'a', date: '2026-11-01', weight: 85 }] });
  st.settings.goalWeight = 75; st.settings.goalStart = 95;
  const s = computeStats(st, '2026-11-02');
  assert.equal(s.startWeight, 95);
  assert.equal(s.lost, 10);
});

test('trophyProgress plafonne la valeur à la cible', () => {
  const t = TROPHIES.find((x) => x.id === 'log7');
  const p = trophyProgress(t, { log: { best: 12 } });
  assert.deepEqual(p, { value: 7, target: 7, done: true });
  assert.equal(trophyProgress(t, { log: { best: 2 } }).done, false);
});

test('trophées : identifiants uniques et groupes connus', () => {
  const ids = TROPHIES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(TROPHIES.every((t) => ['reg', 'nut', 'body', 'fridge'].includes(t.group) && t.target > 0));
  assert.ok(ids.every((id) => /^[a-z0-9-]{1,40}$/.test(id)));
});

test('levelOf : niveaux et progression', () => {
  assert.equal(levelOf(0).name, 'Débutant');
  assert.equal(levelOf(0).next.need, 2);
  assert.equal(levelOf(2).name, 'Lancé');
  assert.equal(levelOf(TROPHIES.length).name, 'Légende');
  assert.equal(levelOf(TROPHIES.length).next, null);
  assert.equal(levelOf(TROPHIES.length).pct, 1);
  assert.ok(LEVELS.every((l, i) => i === 0 || l.min > LEVELS[i - 1].min));
});

test('pickMessage : ton, variables et stabilité', () => {
  assert.equal(pickMessage('back', 0, 'warm', { n: 5 }), pickMessage('back', 0, 'warm', { n: 5 }));
  assert.match(pickMessage('back', 0, 'warm', { n: 5 }), /5 jours/);
  for (let i = 0; i < 6; i++) {
    const fun = pickMessage('morning', i, 'fun'), warm = pickMessage('morning', i, 'warm');
    assert.ok(MESSAGES.morning.some((m) => m.t === 'fun' && m.x === fun));
    assert.ok(MESSAGES.morning.some((m) => m.t === 'warm' && m.x === warm));
  }
  assert.equal(pickMessage('inconnu', 3), '');
});

test('MESSAGES : chaque catégorie a les deux tons et aucune variable orpheline', () => {
  for (const [key, list] of Object.entries(MESSAGES)) {
    assert.ok(list.some((m) => m.t === 'warm') && list.some((m) => m.t === 'fun'), key);
    for (const m of list) {
      const out = pickMessage(key, list.indexOf(m), 'mix', { n: 4, left: 120, protLeft: 20 });
      assert.ok(!/[{}]/.test(out), `${key} : ${out}`);
    }
  }
});

test('seedOf : déterministe', () => {
  assert.equal(seedOf('2026-11-13:going'), seedOf('2026-11-13:going'));
  assert.notEqual(seedOf('a'), seedOf('b'));
});

test('situation : journée vide selon l\'heure et l\'absence', () => {
  const base = { count: 0, kcal: 0, budget: 1900, prot: 0, protGoal: 115, streak: 0, daysAway: null };
  assert.equal(situation({ ...base, hour: 8 }).key, 'morning');
  assert.equal(situation({ ...base, hour: 13 }).key, 'empty');
  assert.equal(situation({ ...base, hour: 20 }).key, 'evening-empty');
  assert.deepEqual(situation({ ...base, hour: 8, daysAway: 4 }), { key: 'back', vars: { n: 4 } });
  assert.equal(situation({ ...base, hour: 8, daysAway: 2 }).key, 'morning');
});

test('situation : journée en cours', () => {
  const base = { hour: 15, count: 3, budget: 1900, protGoal: 115, streak: 0, daysAway: null };
  assert.equal(situation({ ...base, kcal: 2100, prot: 90 }).key, 'over');
  assert.equal(situation({ ...base, kcal: 1700, prot: 120 }).key, 'perfect');
  assert.deepEqual(situation({ ...base, kcal: 1800, prot: 60 }), { key: 'almost', vars: { left: 100 } });
  assert.deepEqual(situation({ ...base, kcal: 1000, prot: 95 }), { key: 'protClose', vars: { protLeft: 20 } });
  assert.deepEqual(situation({ ...base, kcal: 1000, prot: 30, streak: 5 }), { key: 'streak', vars: { n: 5 } });
  assert.equal(situation({ ...base, kcal: 1000, prot: 30 }).key, 'going');
});

test('weekRecap : jours, protéines et tendance de poids', () => {
  const today = '2026-11-20';
  const entries = [entry('2026-11-20', 1800, 120), entry('2026-11-19', 1850, 100), entry('2026-11-18', 2500, 130), entry('2026-11-01', 1800, 120)];
  const body = [{ id: 'a', date: '2026-11-10', weight: 90 }, { id: 'b', date: '2026-11-20', weight: 89 }];
  const r = weekRecap(mkState({ entries, body }), today);
  assert.equal(r.days, 3);
  assert.equal(r.ok, 2);
  assert.equal(r.protDays, 2);
  assert.equal(r.trend, -1);
  assert.equal(r.key, 'weekStart');
  assert.equal(weekRecap(mkState(), today).key, 'weekEmpty');
  const full = Array.from({ length: 5 }, (_, i) => entry(shiftDate(today, -i), 1800));
  assert.equal(weekRecap(mkState({ entries: full }), today).key, 'weekGreat');
});

test('goalKey : paliers', () => {
  assert.deepEqual([0, 0.3, 0.8, 1].map(goalKey), ['goalStart', 'goalMid', 'goalNear', 'goalDone']);
});

test('validateState : objectif, ton et trophées nettoyés', () => {
  const s = validateState({ v: 1, foods: [], entries: [], settings: { goalWeight: '80,5', goalStart: 'abc', tone: 'bizarre' }, trophies: { 'log3': '2026-11-01', 'Mauvais Id': '2026-11-01', 'ok1': 'hier', 'prot1': '2026-11-02' } });
  assert.equal(s.settings.goalWeight, null); // « 80,5 » avec virgule n'est pas un nombre JSON valide
  assert.equal(s.settings.goalStart, null);
  assert.equal(s.settings.tone, 'mix');
  assert.deepEqual(s.trophies, { log3: '2026-11-01', prot1: '2026-11-02' });
  const t = validateState({ v: 1, foods: [], entries: [], settings: { goalWeight: 80.5, goalStart: 95, tone: 'fun' } });
  assert.equal(t.settings.goalWeight, 80.5);
  assert.equal(t.settings.goalStart, 95);
  assert.equal(t.settings.tone, 'fun');
  assert.deepEqual(t.trophies, {});
});
