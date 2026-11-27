// Logique pure de l'appli Muscu (testable sans navigateur).

export const SUGGESTIONS = [
  { name: 'Tractions', unit: 'reps' },
  { name: 'Tractions supination', unit: 'reps' },
  { name: 'Dips', unit: 'reps' },
  { name: 'Pompes', unit: 'reps' },
  { name: 'Pompes déclinées', unit: 'reps' },
  { name: 'Relevés de genoux', unit: 'reps' },
  { name: 'Relevés de jambes', unit: 'reps' },
  { name: 'Squats', unit: 'reps' },
  { name: 'Fentes', unit: 'reps' },
  { name: 'Gainage', unit: 'sec' },
  { name: 'Suspension', unit: 'sec' },
];

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function todayISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function freshState() {
  return {
    v: 1,
    kind: 'muscu',
    settings: { sounds: true, keepAwake: true, defaultRest: 90, weeklyGoal: 2 },
    exercises: [],
    workouts: [],
    sessions: [],
    deleted: [],
    updatedAt: 0,
    active: null,
    timer: null,
  };
}

const str = (x, max = 200) => String(x ?? '').slice(0, max);
const int = (x, min, max, dflt) => {
  const n = Math.round(Number(x));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
const optInt = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Math.max(0, Math.round(Number(x))));
const isoDate = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(x) ? x : todayISO());
const unit = (u) => (u === 'sec' ? 'sec' : 'reps');

/** Nettoie un état venu d'IndexedDB, d'un fichier ou du dépôt. Lève une erreur si ce n'est pas un état Muscu. */
export function validateState(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || raw.kind !== 'muscu') throw new Error('Fichier non reconnu (ce n\'est pas une sauvegarde Muscu).');
  const f = freshState();
  const s = raw.settings || {};
  const exercises = (Array.isArray(raw.exercises) ? raw.exercises : [])
    .map((e) => ({ id: str(e.id, 60), name: str(e.name, 80).trim(), unit: unit(e.unit) }))
    .filter((e) => e.id && e.name);
  const exIds = new Set(exercises.map((e) => e.id));
  const item = (it) => ({ exId: str(it.exId, 60), sets: int(it.sets, 1, 20, 3), rest: int(it.rest, 0, 900, 90), target: str(it.target, 40) });
  const workouts = (Array.isArray(raw.workouts) ? raw.workouts : []).map((w) => ({
    id: str(w.id, 60), name: str(w.name, 80).trim() || 'Séance',
    items: (Array.isArray(w.items) ? w.items : []).map(item).filter((it) => exIds.has(it.exId)),
  })).filter((w) => w.id);
  const sessions = (Array.isArray(raw.sessions) ? raw.sessions : []).map((x) => ({
    id: str(x.id, 60),
    workoutId: x.workoutId ? str(x.workoutId, 60) : null,
    name: str(x.name, 80) || 'Séance',
    date: isoDate(x.date),
    start: x.start ? str(x.start, 40) : null,
    end: x.end ? str(x.end, 40) : null,
    note: str(x.note, 2000),
    items: (Array.isArray(x.items) ? x.items : []).map((it) => ({
      exId: str(it.exId, 60), name: str(it.name, 80), unit: unit(it.unit),
      rest: int(it.rest, 0, 900, 90), target: str(it.target, 40),
      comment: str(it.comment, 2000),
      sets: (Array.isArray(it.sets) ? it.sets : []).slice(0, 30).map((st) => ({ value: optInt(st.value), done: !!st.done })),
    })),
  })).filter((x) => x.id);
  const active = sessions.some((x) => x.id === raw.active && !x.end) ? raw.active : null;
  const t = raw.timer;
  const timer = active && t && Number.isFinite(t.endAt) && Number.isFinite(t.total) ? { endAt: t.endAt, total: t.total, label: str(t.label, 120) } : null;
  return {
    ...f,
    settings: {
      sounds: s.sounds !== false,
      keepAwake: s.keepAwake !== false,
      defaultRest: int(s.defaultRest, 0, 900, 90),
      weeklyGoal: int(s.weeklyGoal, 1, 14, 2),
    },
    exercises, workouts, sessions, active, timer,
    deleted: (Array.isArray(raw.deleted) ? raw.deleted : []).map((x) => str(x, 60)).filter(Boolean).slice(-500),
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Math.max(0, Number(raw.updatedAt)) : 0,
  };
}

export function exById(state, id) {
  return state.exercises.find((e) => e.id === id) || null;
}

/** Trouve ou crée l'exercice de ce nom (insensible à la casse). */
export function ensureExercise(state, name, u = 'reps') {
  const clean = String(name || '').trim().slice(0, 80);
  if (!clean) return null;
  const found = state.exercises.find((e) => e.name.toLowerCase() === clean.toLowerCase());
  if (found) return found;
  const ex = { id: uid(), name: clean, unit: unit(u) };
  state.exercises.push(ex);
  return ex;
}

/** Séances triées de la plus récente à la plus ancienne. */
export function sortedSessions(state) {
  return [...state.sessions].sort((a, b) => (b.date + (b.start || '')).localeCompare(a.date + (a.start || '')));
}

/** Dernière performance enregistrée pour un exercice (au moins une série faite), hors séance donnée. */
export function lastPerf(state, exId, excludeSessionId = null) {
  for (const s of sortedSessions(state)) {
    if (s.id === excludeSessionId) continue;
    const it = s.items.find((i) => i.exId === exId && i.sets.some((st) => st.done));
    if (it) return { session: s, item: it };
  }
  return null;
}

/** Valeur proposée pour la série n : celle de la dernière fois (même rang, sinon la dernière série faite). */
export function suggestedValue(prevItem, setIdx) {
  if (!prevItem) return null;
  const done = prevItem.sets.filter((s) => s.done && s.value != null);
  if (!done.length) return null;
  return (done[setIdx] || done[done.length - 1]).value;
}

/** Valeur proposée pendant la séance : la dernière fois, sinon la série précédente de cette séance. */
export function suggestFor(prevItem, curItem, setIdx) {
  const v = suggestedValue(prevItem, setIdx);
  if (v != null) return v;
  for (let k = setIdx - 1; k >= 0; k--) if (curItem.sets[k]?.done && curItem.sets[k].value != null) return curItem.sets[k].value;
  return null;
}

export function startSession(state, workoutId, now = new Date()) {
  const w = state.workouts.find((x) => x.id === workoutId);
  if (!w) throw new Error('Séance introuvable.');
  const session = {
    id: uid(), workoutId: w.id, name: w.name, date: todayISO(now), start: now.toISOString(), end: null, note: '',
    items: w.items.map((it) => {
      const ex = exById(state, it.exId);
      return {
        exId: it.exId, name: ex?.name || '?', unit: ex?.unit || 'reps', rest: it.rest, target: it.target, comment: '',
        sets: Array.from({ length: it.sets }, () => ({ value: null, done: false })),
      };
    }),
  };
  state.sessions.push(session);
  state.active = session.id;
  state.timer = null;
  return session;
}

/** Position de la prochaine série à faire : { i, j } ou null si tout est fait. */
export function nextSet(session) {
  for (let i = 0; i < session.items.length; i++) {
    const j = session.items[i].sets.findIndex((s) => !s.done);
    if (j >= 0) return { i, j };
  }
  return null;
}

export function itemTotal(item) {
  return item.sets.reduce((n, s) => n + (s.done && s.value ? s.value : 0), 0);
}

export function doneValues(item) {
  return item.sets.filter((s) => s.done && s.value != null).map((s) => s.value);
}

export function remainingSets(session) {
  return session.items.reduce((n, it) => n + it.sets.filter((s) => !s.done).length, 0);
}

/** Semaine ISO (lundi-dimanche) d'une date AAAA-MM-JJ : { year, week, key }. */
export function isoWeek(dateISO) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const year = dt.getUTCFullYear();
  const week = Math.ceil(((dt - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return { year, week, key: `${year}-S${String(week).padStart(2, '0')}` };
}

export function sessionsThisWeek(state, now = new Date()) {
  const k = isoWeek(todayISO(now)).key;
  return state.sessions.filter((s) => s.end && isoWeek(s.date).key === k).length;
}

/** Historique d'un exercice, du plus récent au plus ancien. */
export function exerciseHistory(state, exId) {
  return sortedSessions(state)
    .map((s) => ({ s, it: s.items.find((i) => i.exId === exId) }))
    .filter(({ it }) => it && (it.sets.some((st) => st.done) || it.comment))
    .map(({ s, it }) => {
      const vals = doneValues(it);
      return { sessionId: s.id, date: s.date, week: isoWeek(s.date).week, values: vals, total: itemTotal(it), best: vals.length ? Math.max(...vals) : 0, comment: it.comment, unit: it.unit };
    });
}

/** Secondes restantes d'un chrono (arrondi au-dessus, jamais négatif). */
export function remaining(timer, nowMs = Date.now()) {
  if (!timer) return 0;
  return Math.max(0, Math.ceil((timer.endAt - nowMs) / 1000));
}

export function fmtClock(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtRest(sec) {
  if (sec < 60) return `${sec} s`;
  return sec % 60 ? `${Math.floor(sec / 60)} min ${sec % 60}` : `${sec / 60} min`;
}

export function fmtValue(v, u) {
  return u === 'sec' ? `${v} s` : String(v);
}

/**
 * Fusionne deux copies (appareil + dépôt) sans rien perdre : union par id, la copie la plus récente gagne
 * quand un même élément existe des deux côtés. Les suppressions (`deleted`) sont respectées.
 * `local` garde sa séance en cours et son chrono.
 */
export function mergeStates(local, remote) {
  const newer = local.updatedAt >= remote.updatedAt ? local : remote;
  const older = newer === local ? remote : local;
  const deleted = [...new Set([...(older.deleted || []), ...(newer.deleted || [])])].slice(-500);
  const gone = new Set(deleted);
  const union = (k) => {
    const m = new Map();
    for (const x of older[k]) m.set(x.id, x);
    for (const x of newer[k]) m.set(x.id, x);
    return [...m.values()].filter((x) => !gone.has(x.id));
  };
  const out = {
    ...newer,
    exercises: union('exercises'), workouts: union('workouts'), sessions: union('sessions'),
    deleted, updatedAt: Math.max(local.updatedAt, remote.updatedAt),
    active: local.active, timer: local.timer,
  };
  if (!out.sessions.some((x) => x.id === out.active && !x.end)) { out.active = null; out.timer = null; }
  return validateState(out);
}
