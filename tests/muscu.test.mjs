import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshState, validateState, ensureExercise, startSession, lastPerf, suggestedValue, nextSet,
  itemTotal, remainingSets, suggestFor, mergeStates, isoWeek, sessionsThisWeek, exerciseHistory, remaining, fmtClock, fmtRest, todayISO,
} from '../muscu/js/logic.js';
import { pushSnapshot, fetchSnapshot, dataSize } from '../muscu/js/sync.js';

function setup() {
  const st = freshState();
  const t = ensureExercise(st, 'Tractions');
  const d = ensureExercise(st, 'Dips');
  const g = ensureExercise(st, 'Gainage', 'sec');
  st.workouts.push({ id: 'w1', name: 'Full body', items: [
    { exId: t.id, sets: 3, rest: 120, target: '6-8' },
    { exId: d.id, sets: 2, rest: 90, target: '' },
    { exId: g.id, sets: 1, rest: 60, target: '30 s' },
  ] });
  return { st, t, d, g };
}

test('ensureExercise ne crée pas de doublon (casse ignorée)', () => {
  const { st, t } = setup();
  assert.equal(ensureExercise(st, '  tractions ').id, t.id);
  assert.equal(st.exercises.length, 3);
  assert.equal(ensureExercise(st, '   '), null);
});

test('startSession copie le programme et active la séance', () => {
  const { st } = setup();
  const s = startSession(st, 'w1', new Date(2026, 10, 27, 18, 0));
  assert.equal(st.active, s.id);
  assert.equal(s.date, '2026-11-27');
  assert.deepEqual(s.items.map((i) => i.sets.length), [3, 2, 1]);
  assert.equal(s.items[2].unit, 'sec');
  assert.equal(s.items[0].rest, 120);
  assert.deepEqual(nextSet(s), { i: 0, j: 0 });
  assert.equal(remainingSets(s), 6);
});

test('nextSet et totaux', () => {
  const { st } = setup();
  const s = startSession(st, 'w1');
  s.items[0].sets.forEach((x, k) => { x.done = true; x.value = 8 - k; });
  assert.deepEqual(nextSet(s), { i: 1, j: 0 });
  assert.equal(itemTotal(s.items[0]), 21);
  s.items.forEach((it) => it.sets.forEach((x) => { x.done = true; x.value = x.value ?? 5; }));
  assert.equal(nextSet(s), null);
});

test('lastPerf et suggestedValue reprennent la dernière séance', () => {
  const { st, t } = setup();
  const s1 = startSession(st, 'w1', new Date(2026, 10, 25, 18));
  s1.items[0].sets[0] = { value: 8, done: true };
  s1.items[0].sets[1] = { value: 7, done: true };
  s1.items[0].comment = 'élastique rouge';
  s1.end = new Date(2026, 10, 25, 19).toISOString();
  const s2 = startSession(st, 'w1', new Date(2026, 10, 27, 18));
  const lp = lastPerf(st, t.id, s2.id);
  assert.equal(lp.session.id, s1.id);
  assert.equal(lp.item.comment, 'élastique rouge');
  assert.equal(suggestedValue(lp.item, 0), 8);
  assert.equal(suggestedValue(lp.item, 1), 7);
  assert.equal(suggestedValue(lp.item, 2), 7, 'série absente la dernière fois : on reprend la dernière faite');
  assert.equal(suggestedValue(null, 0), null);
  assert.equal(lastPerf(st, 'inconnu'), null);
});

test('isoWeek : lundi-dimanche, changement d\'année', () => {
  assert.equal(isoWeek('2026-11-27').key, '2026-S48');
  assert.equal(isoWeek('2026-11-23').week, 48);
  assert.equal(isoWeek('2026-11-29').week, 48);
  assert.equal(isoWeek('2026-11-30').week, 49);
  assert.equal(isoWeek('2027-01-01').key, '2026-S53');
});

test('sessionsThisWeek ne compte que les séances terminées de la semaine', () => {
  const { st } = setup();
  const a = startSession(st, 'w1', new Date(2026, 10, 25, 18)); a.end = 'x';
  startSession(st, 'w1', new Date(2026, 10, 27, 18));
  const old = startSession(st, 'w1', new Date(2026, 10, 18, 18)); old.end = 'x';
  assert.equal(sessionsThisWeek(st, new Date(2026, 10, 28)), 1);
});

test('exerciseHistory : valeurs faites, meilleur, commentaire', () => {
  const { st, t } = setup();
  const s = startSession(st, 'w1', new Date(2026, 10, 25, 18));
  s.items[0].sets = [{ value: 8, done: true }, { value: 6, done: true }, { value: 9, done: false }];
  s.items[0].comment = 'lent';
  const h = exerciseHistory(st, t.id);
  assert.equal(h.length, 1);
  assert.deepEqual(h[0].values, [8, 6]);
  assert.equal(h[0].total, 14);
  assert.equal(h[0].best, 8);
  assert.equal(h[0].comment, 'lent');
});

test('validateState : aller-retour, rejet des fichiers étrangers, nettoyage', () => {
  const { st } = setup();
  const s = startSession(st, 'w1');
  st.timer = { endAt: Date.now() + 5000, total: 90, label: 'x' };
  const back = validateState(JSON.parse(JSON.stringify(st)));
  assert.equal(back.active, s.id);
  assert.equal(back.sessions[0].items.length, 3);
  assert.ok(back.timer);
  assert.throws(() => validateState({ v: 1, foods: [], entries: [] }), /Muscu/);
  assert.throws(() => validateState(null));
  const dirty = validateState({ v: 1, kind: 'muscu', exercises: [{ id: 'a', name: 'X' }], workouts: [{ id: 'w', items: [{ exId: 'a', sets: 99, rest: -5 }, { exId: 'zz' }] }], sessions: [], active: 'nope', timer: { endAt: 1, total: 1 } });
  assert.deepEqual(dirty.workouts[0].items, [{ exId: 'a', sets: 20, rest: 0, target: '' }]);
  assert.equal(dirty.active, null);
  assert.equal(dirty.timer, null, 'pas de chrono sans séance active');
  assert.equal(dirty.settings.keepAwake, true);
});

test('chrono : restant et formats', () => {
  assert.equal(remaining({ endAt: 10_500, total: 90 }, 10_000), 1);
  assert.equal(remaining({ endAt: 10_000, total: 90 }, 20_000), 0);
  assert.equal(remaining(null), 0);
  assert.equal(fmtClock(90), '1:30');
  assert.equal(fmtClock(5), '0:05');
  assert.equal(fmtRest(45), '45 s');
  assert.equal(fmtRest(120), '2 min');
  assert.equal(fmtRest(150), '2 min 30');
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

const res = (status, json = {}, text = '') => ({ status, ok: status >= 200 && status < 300, json: async () => json, text: async () => text });
const cfg = { repo: 'Saounaie/data', token: 'ghp_x' };

test('sync : écrit muscu.json (jamais data.json), jeton hors du corps', async () => {
  const calls = [];
  const r = await pushSnapshot(cfg, { v: 1 }, async (url, o) => { calls.push({ url, o }); return res(201, { content: { sha: 's' } }); });
  assert.deepEqual(r, { ok: true, sha: 's' });
  assert.equal(calls[0].url, 'https://api.github.com/repos/Saounaie/data/contents/muscu.json');
  assert.ok(!calls[0].o.body.includes('ghp_x'));
});

test('sync : sha périmé relu puis réessayé ; erreurs traduites', async () => {
  let n = 0;
  const f = async (url, o) => { n++; if (!o.method) return res(200, { sha: 'new' }); return n === 1 ? res(409) : res(200, { content: { sha: 'ok' } }); };
  assert.deepEqual(await pushSnapshot(cfg, {}, f, 'old'), { ok: true, sha: 'ok' });
  assert.equal((await pushSnapshot(cfg, {}, async () => res(401))).code, 'auth');
  assert.equal((await pushSnapshot(cfg, {}, async () => { throw new Error('x'); })).code, 'network');
  assert.deepEqual(await fetchSnapshot(cfg, async () => res(404)), { ok: true, empty: true });
  assert.deepEqual((await fetchSnapshot(cfg, async () => res(200, {}, '{"a":1}'))).state, { a: 1 });
  assert.equal(dataSize({ sessions: [1, 2], workouts: [1], exercises: [] }), 3);
});

test('suggestFor : la dernière fois, sinon la série précédente de la séance', () => {
  const cur = { sets: [{ value: 9, done: true }, { value: null, done: false }] };
  assert.equal(suggestFor(null, cur, 1), 9);
  assert.equal(suggestFor(null, cur, 0), null);
  assert.equal(suggestFor({ sets: [{ value: 7, done: true }, { value: 6, done: true }] }, cur, 1), 6);
});

test('mergeStates : union par id, plus récent gagne, suppressions respectées, séance locale gardée', () => {
  const mk = (t) => ({ ...freshState(), updatedAt: t });
  const ex = (id, name) => ({ id, name, unit: 'reps' });
  const a = mk(100); a.exercises = [ex('e1', 'Tractions')]; a.workouts = [{ id: 'wA', name: 'A (ordi)', items: [{ exId: 'e1', sets: 4, rest: 120, target: '' }] }];
  const b = mk(200); b.exercises = [ex('e1', 'Tractions'), ex('e2', 'Dips')]; b.workouts = [{ id: 'wA', name: 'A', items: [{ exId: 'e1', sets: 3, rest: 90, target: '' }] }, { id: 'wB', name: 'B', items: [] }];
  const m = mergeStates(a, b);
  assert.deepEqual(m.workouts.map((w) => w.id).sort(), ['wA', 'wB']);
  assert.equal(m.workouts.find((w) => w.id === 'wA').name, 'A', 'la copie la plus récente gagne');
  assert.equal(m.exercises.length, 2);
  assert.equal(m.updatedAt, 200);
  b.deleted = ['wB']; a.workouts.push({ id: 'wB', name: 'B', items: [] });
  assert.ok(!mergeStates(a, b).workouts.some((w) => w.id === 'wB'), 'suppression propagée');
  const l = mk(300); l.exercises = [ex('e1', 'T')]; l.workouts = [{ id: 'w1', name: 'S', items: [{ exId: 'e1', sets: 1, rest: 0, target: '' }] }];
  const s1 = startSession(l, 'w1'); l.timer = { endAt: Date.now() + 9000, total: 9, label: 'x' };
  const m2 = mergeStates(l, mk(100));
  assert.equal(m2.active, s1.id); assert.ok(m2.timer);
  assert.equal(mergeStates(mk(100), l).sessions.length, 1);
  assert.equal(validateState(JSON.parse(JSON.stringify(m2))).updatedAt, 300);
});
