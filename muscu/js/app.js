// Appli Muscu : séances, séries, reps, chrono de récupération, commentaires par exercice.
import * as L from './logic.js';
import { loadState, saveState, askPersistent } from './store.js';
import { pushSnapshot, fetchSnapshot, validRepo, dataSize } from './sync.js';
import { APP_VERSION } from './version.js';

let state = L.freshState();
let tab = 'home';            // home | history | program | settings
let view = null;             // { type: 'session'|'workout'|'exercise', id }
let openItem = null;         // exercice déplié dans la séance
const $ = (s) => document.querySelector(s);
const main = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dayFmt = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', opts);

/* ---------- Petits outils ---------- */
let toastTimer = null;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show ' + kind;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), 2600);
}

let saveTimer = null;
async function persist() { clearTimeout(saveTimer); state.updatedAt = Date.now(); await saveState(state); scheduleSync(); }
function persistSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 600); }

/* ---------- Sons (Web Audio : coupés par le mode silencieux de l'iPhone) ---------- */
let actx = null;
function audio() {
  if (!state.settings.sounds) return null;
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); return actx; } catch (_) { return null; }
}
function tone(freq, start, dur, gain = 0.18) {
  const a = audio(); if (!a) return;
  const t0 = a.currentTime + start, o = a.createOscillator(), g = a.createGain();
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}
const sfx = {
  tap: () => tone(600, 0, 0.05, 0.05),
  tick: () => tone(880, 0, 0.12, 0.15),
  go: () => { tone(880, 0, 0.18); tone(1175, 0.2, 0.18); tone(1568, 0.4, 0.45, 0.22); },
  done: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.3, 0.12)); },
};
const buzz = (p) => { try { navigator.vibrate?.(p); } catch (_) { /* iPhone : pas de vibration web */ } };

/* ---------- Écran allumé pendant la séance ---------- */
let wakeLock = null;
async function syncWakeLock() {
  const want = !!state.active && state.settings.keepAwake && document.visibilityState === 'visible';
  try {
    if (want && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (_) { wakeLock = null; }
}

/* ---------- Chrono de récupération (basé sur l'heure de fin : juste même après un verrouillage) ---------- */
let alerted = null, lastTick = null, goUntil = 0, goLabel = '';
function startTimer(sec, label) {
  if (!sec) return;
  state.timer = { endAt: Date.now() + sec * 1000, total: sec, label };
  alerted = null; lastTick = null; goUntil = 0;
  persist(); drawTimer();
}
function adjustTimer(delta) {
  if (!state.timer) return;
  state.timer.endAt = Math.max(Date.now() + 1000, state.timer.endAt + delta * 1000);
  state.timer.total = Math.max(state.timer.total, Math.ceil((state.timer.endAt - Date.now()) / 1000));
  persist(); drawTimer();
}
function stopTimer() {
  state.timer = null; persist(); drawTimer();
}
function drawTimer() {
  const el = $('#timer');
  const now = Date.now();
  if (state.timer) {
    const left = L.remaining(state.timer, now);
    if (left <= 0) {
      const lateBy = (now - state.timer.endAt) / 1000;
      if (alerted !== state.timer.endAt && lateBy < 30) { sfx.go(); buzz([300, 120, 300, 120, 500]); }
      alerted = state.timer.endAt;
      goUntil = lateBy < 30 ? now + 7000 : 0; goLabel = state.timer.label;
      state.timer = null; persist();
    } else {
      if (left <= 3 && lastTick !== left) { lastTick = left; sfx.tick(); buzz(80); }
      const pct = Math.min(100, (1 - (state.timer.endAt - now) / (state.timer.total * 1000)) * 100);
      el.className = 'show';
      el.innerHTML = `<div class="t-top"><span class="small muted">Récup · ensuite ${esc(state.timer.label)}</span></div>
        <div class="t-clock">${L.fmtClock(left)}</div>
        <div class="bar"><i style="width:${pct}%;animation:none"></i></div>
        <div class="t-btns"><button class="btn" data-action="t-minus">−15 s</button><button class="btn" data-action="t-plus">+15 s</button><button class="btn primary" data-action="t-skip">Passer</button></div>`;
      document.body.classList.add('has-timer');
      return;
    }
  }
  if (goUntil > now) {
    el.className = 'show go';
    el.innerHTML = `<div class="t-clock go">C'est reparti !</div><div class="t-go-label">${esc(goLabel)}</div>
      <div class="t-btns"><button class="btn primary block" data-action="t-close">OK</button></div>`;
    document.body.classList.add('has-timer');
    return;
  }
  el.className = ''; el.innerHTML = '';
  document.body.classList.remove('has-timer');
}
setInterval(() => { if (state.timer || goUntil) { drawTimer(); if (!state.timer && goUntil && goUntil < Date.now()) { goUntil = 0; drawTimer(); } } }, 250);

/* ---------- Rendu ---------- */
function setTab(t) { tab = t; view = null; render(); window.scrollTo(0, 0); }
function openView(v) { view = v; render(); window.scrollTo(0, 0); }

function render() {
  const inSession = view?.type === 'session' && view.id === state.active;
  document.body.classList.toggle('in-session', inSession);
  document.querySelectorAll('#tabs button').forEach((b) => (b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (view?.type === 'session') renderSession();
  else if (view?.type === 'workout') renderWorkoutEdit();
  else if (view?.type === 'exercise') renderExercise();
  else ({ home: renderHome, history: renderHistory, program: renderProgram, settings: renderSettings })[tab]();
  drawTimer(); syncWakeLock();
}

const ICON_PLUS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const sessionSets = (s) => s.items.reduce((n, it) => n + it.sets.filter((x) => x.done).length, 0);
const sessionDuration = (s) => {
  if (!s.start || !s.end || s.end === 'x') return '';
  const min = Math.round((new Date(s.end) - new Date(s.start)) / 60000);
  return min > 0 && min < 600 ? (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`) : '';
};

function renderHome() {
  const done = L.sessionsThisWeek(state), goal = state.settings.weeklyGoal;
  const active = state.sessions.find((s) => s.id === state.active);
  const recent = L.sortedSessions(state).filter((s) => s.end).slice(0, 4);
  main.innerHTML = `
    <h1>Muscu</h1>
    <p class="muted" style="margin:6px 0 0">Cette semaine : <b style="color:var(--text)">${done} / ${goal}</b> séance${goal > 1 ? 's' : ''}</p>
    <div class="dots">${Array.from({ length: goal }, (_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join('')}</div>
    ${active ? `<div class="card hero">
        <div class="small muted">Séance en cours</div>
        <div class="hero-name">${esc(active.name)}</div>
        <div class="small muted">${sessionSets(active)} série(s) faite(s) · ${L.remainingSets(active)} restante(s)</div>
        <button class="btn primary block big-btn" data-action="open-session" data-id="${active.id}">Reprendre</button>
      </div>` : ''}
    ${!active && state.workouts.length ? `<h2>Démarrer</h2>` + state.workouts.map((w) => `
      <div class="card">
        <div class="hero-name">${esc(w.name)}</div>
        <div class="small muted" style="margin:4px 0 14px">${w.items.map((it) => esc(L.exById(state, it.exId)?.name)).join(' · ') || 'Aucun exercice'}</div>
        <button class="btn primary block big-btn" data-action="start" data-id="${w.id}" ${w.items.length ? '' : 'disabled'}>Démarrer la séance</button>
      </div>`).join('') : ''}
    ${!state.workouts.length ? `<div class="card stack" style="margin-top:18px">
        <div class="hero-name">Bienvenue</div>
        <p class="muted" style="margin:0">Crée ta séance type : tes exercices, le nombre de séries et le temps de récup. Tu la lanceras ensuite d'un geste à chaque entraînement.</p>
        <button class="btn primary block big-btn" data-action="new-workout">Créer ma séance</button>
      </div>` : ''}
    ${recent.length ? `<h2>Dernières séances</h2><div class="list">${recent.map(sessionRow).join('')}</div>` : ''}`;
}

function sessionRow(s) {
  const dur = sessionDuration(s);
  return `<button class="item" data-action="open-session" data-id="${s.id}">
    <div><div>${esc(s.name)}</div><div class="sub">${dayFmt(s.date)} · ${sessionSets(s)} séries${dur ? ' · ' + dur : ''}${s.end ? '' : ' · en cours'}</div></div>
    <span class="chev">›</span></button>`;
}

function setRow(s, i, j, prev, editable) {
  const it = s.items[i], set = it.sets[j];
  const sug = L.suggestFor(prev, it, j);
  return `<div class="set-row ${set.done ? 'done' : ''}">
    <span class="set-n">${j + 1}</span>
    <button class="step" data-action="dec" data-i="${i}" data-j="${j}" aria-label="Moins">−</button>
    <input class="set-val" type="number" inputmode="numeric" pattern="[0-9]*" min="0" data-i="${i}" data-j="${j}" value="${set.value ?? ''}" placeholder="${sug ?? (it.unit === 'sec' ? 's' : 'reps')}" aria-label="Série ${j + 1}">
    <button class="step" data-action="inc" data-i="${i}" data-j="${j}" aria-label="Plus">+</button>
    <button class="check" data-action="check" data-i="${i}" data-j="${j}" aria-label="Série faite" ${editable ? '' : 'disabled'}>✓</button>
  </div>`;
}

function renderSession() {
  const s = state.sessions.find((x) => x.id === view.id);
  if (!s) { view = null; return render(); }
  const active = s.id === state.active;
  if (active && openItem == null) openItem = L.nextSet(s)?.i ?? 0;
  main.innerHTML = `
    <div class="row between top-row">
      <button class="icon-btn" data-action="back">‹ ${active ? 'Accueil' : 'Retour'}</button>
      ${active ? `<span class="pill" id="elapsed"></span>` : ''}
    </div>
    <h1>${esc(s.name)}</h1>
    ${active ? `<p class="muted small" style="margin:6px 0 0">${dayFmt(s.date, { weekday: 'long', day: 'numeric', month: 'long' })} · semaine ${L.isoWeek(s.date).week}</p>`
      : `<label style="margin-top:12px">Date<input type="date" id="sess-date" value="${s.date}"></label>`}
    ${s.items.map((it, i) => {
      const lp = L.lastPerf(state, it.exId, s.id);
      const open = !active || openItem === i;
      const nDone = it.sets.filter((x) => x.done).length;
      return `<section class="card ex ${open ? 'open' : ''} ${nDone === it.sets.length ? 'complete' : ''}" id="ex-${i}">
        <button class="ex-head" data-action="toggle-item" data-i="${i}">
          <span class="ex-name">${esc(it.name)}</span>
          <span class="ex-meta">${it.target ? `<span class="pill">${esc(it.target)}</span>` : ''}<span class="small muted">${nDone}/${it.sets.length}</span></span>
        </button>
        ${open ? `
          <div class="small muted last">${lp ? `La dernière fois (${dayFmt(lp.session.date)}) : <b>${L.doneValues(lp.item).map((v) => L.fmtValue(v, it.unit)).join(' · ')}</b>${lp.item.comment ? `<br><i>« ${esc(lp.item.comment)} »</i>` : ''}` : 'Première fois : note tes reps.'}</div>
          <div class="sets">${it.sets.map((_, j) => setRow(s, i, j, lp?.item, true)).join('')}</div>
          <div class="row between ex-tools">
            <span class="small muted">Récup ${L.fmtRest(it.rest)}${it.unit === 'sec' ? ' · en secondes' : ''}</span>
            <span class="row" style="gap:4px"><button class="icon-btn" data-action="del-set" data-i="${i}">− série</button><button class="icon-btn" data-action="add-set" data-i="${i}">+ série</button></span>
          </div>
          <textarea class="comment" data-i="${i}" rows="2" placeholder="Commentaire (élastique, résistance, sensations…)">${esc(it.comment)}</textarea>`
        : `<div class="small muted collapsed">${L.doneValues(it).map((v) => L.fmtValue(v, it.unit)).join(' · ') || (lp ? 'Dernière fois : ' + L.doneValues(lp.item).map((v) => L.fmtValue(v, it.unit)).join(' · ') : '')}${it.comment ? ' · 💬' : ''}</div>`}
      </section>`;
    }).join('')}
    <h2>Note de séance</h2>
    <textarea id="sess-note" rows="2" placeholder="Forme du jour, douleurs, conditions…">${esc(s.note)}</textarea>
    <div class="stack" style="margin-top:18px">
      ${active ? `<button class="btn primary block big-btn" data-action="finish">Terminer la séance</button>` : ''}
      <button class="btn danger block" data-action="delete-session">Supprimer cette séance</button>
    </div>`;
  updateElapsed();
}

function updateElapsed() {
  const el = $('#elapsed'); const s = state.sessions.find((x) => x.id === state.active);
  if (!el || !s?.start) return;
  el.textContent = '⏱ ' + L.fmtClock((Date.now() - new Date(s.start)) / 1000).replace(/^(\d+):/, (m, a) => (a >= 60 ? `${Math.floor(a / 60)} h ${String(a % 60).padStart(2, '0')}:` : m));
}
setInterval(updateElapsed, 1000);

function renderHistory() {
  const list = L.sortedSessions(state);
  const groups = [];
  for (const s of list) {
    const w = L.isoWeek(s.date);
    let g = groups.find((x) => x.key === w.key);
    if (!g) groups.push(g = { key: w.key, week: w.week, items: [] });
    g.items.push(s);
  }
  const exs = state.exercises.filter((e) => state.sessions.some((s) => s.items.some((i) => i.exId === e.id)));
  main.innerHTML = `<h1>Historique</h1>
    ${exs.length ? `<h2>Progrès par exercice</h2><div class="chips">${exs.map((e) => `<button class="chip" data-action="open-exercise" data-id="${e.id}">${esc(e.name)}</button>`).join('')}</div>` : ''}
    ${groups.length ? groups.map((g) => `<h2>Semaine ${g.week} · ${g.items.filter((s) => s.end).length} séance(s)</h2><div class="list">${g.items.map(sessionRow).join('')}</div>`).join('')
      : '<p class="muted">Aucune séance enregistrée pour l\'instant.</p>'}`;
}

function renderExercise() {
  const ex = L.exById(state, view.id);
  if (!ex) { view = null; return render(); }
  const h = L.exerciseHistory(state, ex.id);
  const pts = h.slice(0, 12).reverse();
  const max = Math.max(1, ...pts.map((p) => p.total));
  const W = 320, H = 120, bw = W / Math.max(pts.length, 1);
  const chart = pts.length > 1 ? `<svg class="chart" viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="Total par séance">
    ${pts.map((p, k) => { const bh = Math.max(3, (p.total / max) * H); return `<rect x="${k * bw + bw * 0.18}" y="${H - bh}" width="${bw * 0.64}" height="${bh}" rx="5"></rect><text x="${k * bw + bw / 2}" y="${H - bh - 4}" text-anchor="middle">${p.total}</text><text class="lbl" x="${k * bw + bw / 2}" y="${H + 14}" text-anchor="middle">S${p.week}</text>`; }).join('')}
  </svg>` : '';
  main.innerHTML = `<div class="top-row"><button class="icon-btn" data-action="back">‹ Retour</button></div>
    <h1>${esc(ex.name)}</h1>
    ${h.length ? `<p class="muted small" style="margin:6px 0 0">Meilleure série : <b style="color:var(--text)">${L.fmtValue(Math.max(...h.map((x) => x.best)), ex.unit)}</b> · total ${ex.unit === 'sec' ? 'secondes' : 'reps'} par séance ci-dessous</p>` : ''}
    ${chart ? `<div class="card" style="margin-top:16px">${chart}</div>` : ''}
    <h2>Séances</h2>
    <div class="list">${h.map((x) => `<button class="item" data-action="open-session" data-id="${x.sessionId}"><div>
      <div>${x.values.map((v) => L.fmtValue(v, x.unit)).join(' · ') || '—'} <span class="muted small">(total ${x.total})</span></div>
      <div class="sub">${dayFmt(x.date)} · semaine ${x.week}${x.comment ? ` · « ${esc(x.comment)} »` : ''}</div></div><span class="chev">›</span></button>`).join('') || '<div class="item muted">Rien pour l\'instant.</div>'}</div>`;
}

function renderProgram() {
  main.innerHTML = `<h1>Programme</h1>
    <p class="muted small" style="margin:6px 0 0">Tes séances types. Les modifier ne change pas les séances déjà faites.</p>
    <div class="list" style="margin-top:16px">
      ${state.workouts.map((w) => `<button class="item" data-action="edit-workout" data-id="${w.id}"><div><div>${esc(w.name)}</div>
        <div class="sub">${w.items.length} exercice(s) · ${w.items.reduce((n, it) => n + it.sets, 0)} séries</div></div><span class="chev">›</span></button>`).join('')}
      <button class="item add-row" data-action="new-workout">${ICON_PLUS} Nouvelle séance type</button>
    </div>`;
}

const RESTS = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
function renderWorkoutEdit() {
  const w = state.workouts.find((x) => x.id === view.id);
  if (!w) { view = null; return render(); }
  const used = new Set(w.items.map((it) => L.exById(state, it.exId)?.name.toLowerCase()));
  const sugg = [...L.SUGGESTIONS.map((x) => x.name), ...state.exercises.map((e) => e.name)]
    .filter((n, k, a) => a.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === k && !used.has(n.toLowerCase()));
  main.innerHTML = `<div class="top-row"><button class="icon-btn" data-action="back">‹ Programme</button></div>
    <label>Nom de la séance<input type="text" id="w-name" value="${esc(w.name)}" maxlength="80"></label>
    <h2>Exercices (dans l'ordre)</h2>
    ${w.items.map((it, k) => {
      const ex = L.exById(state, it.exId);
      return `<div class="card w-item">
        <div class="row between"><b>${k + 1}. ${esc(ex?.name)}</b>
          <span class="row" style="gap:0"><button class="icon-btn" data-action="w-up" data-k="${k}" ${k ? '' : 'disabled'} aria-label="Monter">↑</button><button class="icon-btn" data-action="w-down" data-k="${k}" ${k < w.items.length - 1 ? '' : 'disabled'} aria-label="Descendre">↓</button><button class="icon-btn danger-t" data-action="w-del" data-k="${k}" aria-label="Retirer">✕</button></span></div>
        <div class="grid3">
          <label>Séries<span class="stepper"><button class="step" data-action="w-sets" data-k="${k}" data-d="-1">−</button><b>${it.sets}</b><button class="step" data-action="w-sets" data-k="${k}" data-d="1">+</button></span></label>
          <label>Récup<select data-field="rest" data-k="${k}">${RESTS.map((r) => `<option value="${r}" ${r === it.rest ? 'selected' : ''}>${r ? L.fmtRest(r) : 'aucune'}</option>`).join('')}${RESTS.includes(it.rest) ? '' : `<option selected value="${it.rest}">${L.fmtRest(it.rest)}</option>`}</select></label>
          <label>Objectif<input type="text" data-field="target" data-k="${k}" value="${esc(it.target)}" placeholder="${ex?.unit === 'sec' ? '30 s' : '8-12'}" maxlength="40"></label>
        </div>
      </div>`;
    }).join('') || '<p class="muted">Ajoute tes exercices ci-dessous.</p>'}
    <h2>Ajouter un exercice</h2>
    <div class="chips">${sugg.map((n) => `<button class="chip" data-action="w-add" data-name="${esc(n)}">+ ${esc(n)}</button>`).join('')}</div>
    <div class="card stack" style="margin-top:12px">
      <label>Autre exercice<input type="text" id="w-new" placeholder="Ex. : Tractions lestées" maxlength="80"></label>
      <div class="chips" id="w-unit"><button class="chip on" data-unit="reps">En reps</button><button class="chip" data-unit="sec">En secondes</button></div>
      <button class="btn block" data-action="w-add-custom">Ajouter</button>
    </div>
    <div class="stack" style="margin-top:24px">
      <button class="btn primary block big-btn" data-action="back">Terminé</button>
      <button class="btn danger block" data-action="w-remove">Supprimer cette séance type</button>
    </div>`;
}

/* ---------- Réglages et synchronisation ---------- */
const ls = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* ignore */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } },
};
const K = { cfg: 'muscu.syncCfg', status: 'muscu.syncStatus', dirty: 'muscu.syncDirty' };
let syncSha = null, syncTimer = null, syncBusy = false;

function scheduleSync() {
  const cfg = ls.get(K.cfg); if (!cfg?.token || !cfg?.repo) return;
  ls.set(K.dirty, true); clearTimeout(syncTimer); syncTimer = setTimeout(doSync, 4000);
}
async function doSync() {
  const cfg = ls.get(K.cfg);
  if (!cfg?.token || !cfg?.repo || syncBusy) return null;
  clearTimeout(syncTimer); syncBusy = true;
  const r = await pushSnapshot(cfg, state, fetch, syncSha);
  syncBusy = false;
  if (r.ok) { syncSha = r.sha; ls.del(K.dirty); ls.set(K.status, { ok: true, at: new Date().toISOString() }); }
  else ls.set(K.status, { ok: false, at: new Date().toISOString(), message: r.message });
  showSyncInfo(); return r;
}
/** Récupère la copie du dépôt (écrite par un autre appareil) : adoptée si plus récente, fusionnée si on a des changements non envoyés. */
let pulling = false;
async function pullRemote() {
  const cfg = ls.get(K.cfg);
  if (!cfg?.token || !cfg?.repo || pulling || syncBusy) return;
  pulling = true;
  try {
    const remote = await fetchSnapshot(cfg);
    if (!remote.ok || !remote.state) return;
    let rs; try { rs = L.validateState(remote.state); } catch (_) { return; }
    const dirty = !!ls.get(K.dirty);
    if (rs.updatedAt <= state.updatedAt) { if (dirty) doSync(); return; }
    const editing = document.activeElement?.matches?.('input, textarea, select');
    state = dirty ? L.mergeStates(state, rs) : { ...rs, active: state.active && rs.sessions.some((x) => x.id === state.active && !x.end) ? state.active : rs.active, timer: state.timer };
    await saveState(state);
    if (dirty) { await persist(); }
    if (!state.active) state.timer = null;
    if (view?.type === 'session' && !state.sessions.some((x) => x.id === view.id)) view = null;
    if (!editing) render();
    toast('Données mises à jour depuis l\'autre appareil');
  } finally { pulling = false; }
}

function showSyncInfo() {
  const el = $('#sync-info'); if (!el) return;
  const cfg = ls.get(K.cfg), st = ls.get(K.status);
  const when = st ? new Date(st.at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  el.innerHTML = !cfg?.token ? 'Synchronisation désactivée.'
    : st?.ok ? `<span style="color:var(--accent)">Dernière copie réussie : ${esc(when)}</span>`
    : st ? `<span style="color:var(--danger)">Échec (${esc(when)}) : ${esc(st.message)}</span>` : 'En attente de la première copie.';
}

function renderSettings() {
  const s = state.settings, cfg = ls.get(K.cfg), shared = ls.get('syncCfg');
  main.innerHTML = `<h1>Réglages</h1>
    <h2>Séance</h2>
    <div class="card stack">
      <div class="row between"><span>Sons du chrono</span><button class="chip ${s.sounds ? 'on' : ''}" data-action="toggle" data-key="sounds">${s.sounds ? 'Activés' : 'Coupés'}</button></div>
      <div class="row between"><span>Écran allumé pendant la séance</span><button class="chip ${s.keepAwake ? 'on' : ''}" data-action="toggle" data-key="keepAwake">${s.keepAwake ? 'Oui' : 'Non'}</button></div>
      <label>Séances visées par semaine<select id="set-goal">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option ${n === s.weeklyGoal ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <p class="small muted" style="margin:0">Le chrono reste juste même écran verrouillé, mais l'iPhone ne laisse pas une appli web sonner quand il est verrouillé : garde l'écran allumé (réglage ci-dessus) et le mode silencieux désactivé pour entendre le bip.</p>
    </div>
    <h2>Synchronisation avec Claude</h2>
    <div class="card stack">
      <p class="small muted" style="margin:0">Copie tes séances dans le fichier <b>muscu.json</b> de ton dépôt GitHub <b>privé</b> (le même que l'appli Suivi, qui garde son propre fichier). Claude peut ainsi lire tes reps et commentaires.</p>
      <label>Dépôt privé (compte/nom)<input type="text" id="sync-repo" value="${esc(cfg?.repo || shared?.repo || '')}" placeholder="Saounaie/suivi-nutrition-data" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label>Jeton d'accès GitHub<input type="password" id="sync-token" placeholder="${cfg?.token ? '•••••••• (enregistré)' : 'github_pat_…'}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      ${!cfg?.token && shared?.token ? '<button class="btn block" data-action="use-shared">Utiliser le jeton de l\'appli Suivi</button>' : ''}
      ${!cfg?.token ? '<p class="small muted" style="margin:0">Le plus simple : dans l\'appli Suivi, Réglages › Synchronisation › « Copier le jeton pour l\'appli Muscu », puis colle-le ici.</p>' : ''}
      <button class="btn primary block" data-action="sync-save">Enregistrer et synchroniser</button>
      <div class="small" id="sync-info"></div>
      ${cfg?.token ? '<button class="btn danger block" data-action="sync-off">Désactiver et effacer le jeton</button>' : ''}
    </div>
    <h2>Sauvegarde</h2>
    <div class="card stack">
      <button class="btn block" data-action="export">Exporter mes séances (fichier)</button>
      <label class="btn block file-btn">Importer un fichier<input type="file" id="import" accept="application/json,.json" hidden></label>
    </div>
    <h2>Application</h2>
    <div class="card stack">
      <div class="row between"><span>Version</span><b>${APP_VERSION}</b></div>
      <button class="btn block" data-action="update-now">Mettre à jour maintenant</button>
      <p class="small muted" style="margin:0">Cherche la dernière version sans toucher à tes données. <b>Ne supprime jamais l'icône de l'écran d'accueil</b> : ça efface toutes tes séances.</p>
    </div>`;
  showSyncInfo();
}

async function saveSync(tokenOverride) {
  const cfg = ls.get(K.cfg);
  const repo = $('#sync-repo').value.trim(), token = tokenOverride || $('#sync-token').value.trim() || cfg?.token || '';
  if (!validRepo(repo)) return toast('Dépôt invalide : écris-le sous la forme compte/nom', 'error');
  if (!token) return toast('Colle ton jeton GitHub', 'error');
  $('#sync-info').textContent = 'Vérification de la copie en ligne…';
  const remote = await fetchSnapshot({ repo, token });
  if (!remote.ok) { $('#sync-info').textContent = remote.message; return toast(remote.message, 'error'); }
  if (remote.state) {
    let rs = null; try { rs = L.validateState(remote.state); } catch (_) { /* illisible : on ne fusionne pas */ }
    if (rs && dataSize(rs) > 0) { state = dataSize(state) === 0 ? rs : L.mergeStates(state, rs); await saveState(state); }
  }
  ls.set(K.cfg, { repo, token });
  const r = await doSync();
  toast(r?.ok ? 'Synchronisation active' : (r?.message || 'Échec'), r?.ok ? 'success' : 'error');
  render();
}

function exportFile() {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `muscu-${L.todayISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function forceUpdate() {
  toast('Recherche de la dernière version…');
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(regs.filter((r) => r.scope.includes('/muscu/')).map((r) => r.unregister()));
    if (window.caches) await Promise.all((await caches.keys()).filter((k) => k.startsWith('muscu-')).map((k) => caches.delete(k)));
  } catch (_) { /* on recharge quand même */ }
  location.reload();
}

/* ---------- Actions ---------- */
const curSession = () => state.sessions.find((x) => x.id === view?.id);
const curWorkout = () => state.workouts.find((x) => x.id === view?.id);

function checkSet(i, j) {
  const s = curSession(); const it = s.items[i]; const set = it.sets[j];
  if (set.done) { set.done = false; persist(); return render(); }
  const input = document.querySelector(`.set-val[data-i="${i}"][data-j="${j}"]`);
  let v = input?.value === '' ? null : Number(input?.value);
  if (v == null) v = L.suggestFor(L.lastPerf(state, it.exId, s.id)?.item, it, j);
  if (v == null || !Number.isFinite(v)) { toast(it.unit === 'sec' ? 'Indique la durée tenue' : 'Indique tes reps', 'error'); input?.focus(); return; }
  set.value = Math.max(0, Math.round(v)); set.done = true;
  buzz(30);
  const active = s.id === state.active;
  const next = L.nextSet(s);
  if (active && next) {
    const nIt = s.items[next.i];
    const label = next.i === i ? `${it.name} · série ${next.j + 1}` : `${nIt.name} · série ${next.j + 1}`;
    if (next.i !== i) openItem = next.i;
    sfx.tap();
    startTimer(it.rest, label);
  } else if (active && !next) { sfx.done(); toast('Toutes les séries sont faites, bravo ! Termine la séance.', 'success'); stopTimer(); }
  persist();
  render();
  if (active && openItem !== i) document.getElementById('ex-' + openItem)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function stepSet(i, j, d) {
  const s = curSession(); const it = s.items[i]; const set = it.sets[j];
  const base = set.value ?? L.suggestFor(L.lastPerf(state, it.exId, s.id)?.item, it, j) ?? 0;
  const inc = it.unit === 'sec' ? 5 : 1;
  set.value = Math.max(0, base + d * inc);
  const input = document.querySelector(`.set-val[data-i="${i}"][data-j="${j}"]`);
  if (input) input.value = set.value;
  sfx.tap(); persistSoon();
}

const actions = {
  start: (b) => { const s = L.startSession(state, b.dataset.id); openItem = null; persist(); askPersistent(); audio(); openView({ type: 'session', id: s.id }); },
  'open-session': (b) => { openItem = null; openView({ type: 'session', id: b.dataset.id }); },
  'open-exercise': (b) => openView({ type: 'exercise', id: b.dataset.id }),
  back: () => { const from = view?.type; view = null; if (from === 'workout') tab = 'program'; render(); window.scrollTo(0, 0); },
  'toggle-item': (b) => { const i = Number(b.dataset.i); if (curSession()?.id !== state.active) return; openItem = openItem === i ? null : i; render(); document.getElementById('ex-' + i)?.scrollIntoView({ block: 'nearest' }); },
  check: (b) => checkSet(Number(b.dataset.i), Number(b.dataset.j)),
  inc: (b) => stepSet(Number(b.dataset.i), Number(b.dataset.j), 1),
  dec: (b) => stepSet(Number(b.dataset.i), Number(b.dataset.j), -1),
  'add-set': (b) => { curSession().items[Number(b.dataset.i)].sets.push({ value: null, done: false }); persist(); render(); },
  'del-set': (b) => { const it = curSession().items[Number(b.dataset.i)]; if (it.sets.length <= 1) return; const k = it.sets.map((x) => x.done).lastIndexOf(false); it.sets.splice(k >= 0 ? k : it.sets.length - 1, 1); persist(); render(); },
  finish: async () => {
    const s = curSession(); const left = L.remainingSets(s);
    if (left && !confirm(`Il reste ${left} série(s) non cochée(s). Terminer quand même ?`)) return;
    s.end = new Date().toISOString(); state.active = null; state.timer = null; goUntil = 0; openItem = null;
    await persist(); sfx.done(); toast('Séance enregistrée 💪', 'success'); view = null; tab = 'home'; render(); window.scrollTo(0, 0);
  },
  'delete-session': async () => {
    if (!confirm('Supprimer définitivement cette séance ?')) return;
    const id = curSession().id; state.sessions = state.sessions.filter((x) => x.id !== id); state.deleted.push(id);
    if (state.active === id) { state.active = null; state.timer = null; }
    await persist(); view = null; render(); toast('Séance supprimée');
  },
  't-minus': () => adjustTimer(-15), 't-plus': () => adjustTimer(15), 't-skip': () => stopTimer(), 't-close': () => { goUntil = 0; drawTimer(); },
  'new-workout': () => { const w = { id: L.uid(), name: state.workouts.length ? 'Nouvelle séance' : 'Full body', items: [] }; state.workouts.push(w); persist(); tab = 'program'; openView({ type: 'workout', id: w.id }); },
  'edit-workout': (b) => openView({ type: 'workout', id: b.dataset.id }),
  'w-add': (b) => { const sug = L.SUGGESTIONS.find((x) => x.name === b.dataset.name); addToWorkout(b.dataset.name, sug?.unit); },
  'w-add-custom': () => { const n = $('#w-new').value.trim(); if (!n) return toast('Écris le nom de l\'exercice', 'error'); addToWorkout(n, document.querySelector('#w-unit .on')?.dataset.unit); },
  'w-up': (b) => moveItem(Number(b.dataset.k), -1), 'w-down': (b) => moveItem(Number(b.dataset.k), 1),
  'w-del': (b) => { curWorkout().items.splice(Number(b.dataset.k), 1); persist(); render(); },
  'w-sets': (b) => { const it = curWorkout().items[Number(b.dataset.k)]; it.sets = Math.min(20, Math.max(1, it.sets + Number(b.dataset.d))); persist(); render(); },
  'w-remove': async () => { if (!confirm('Supprimer cette séance type ? (Les séances déjà faites sont gardées.)')) return; state.deleted.push(view.id); state.workouts = state.workouts.filter((w) => w.id !== view.id); await persist(); view = null; tab = 'program'; render(); },
  toggle: (b) => { state.settings[b.dataset.key] = !state.settings[b.dataset.key]; persist(); render(); },
  'use-shared': () => saveSync(ls.get('syncCfg')?.token),
  'sync-save': () => saveSync(),
  'sync-off': () => { if (!confirm('Désactiver la synchronisation et effacer le jeton de cette appli ?')) return; Object.values(K).forEach(ls.del); syncSha = null; render(); },
  export: exportFile,
  'update-now': forceUpdate,
};

function addToWorkout(name, unit) {
  const ex = L.ensureExercise(state, name, unit);
  curWorkout().items.push({ exId: ex.id, sets: 3, rest: state.settings.defaultRest, target: '' });
  persist(); render();
}
function moveItem(k, d) {
  const items = curWorkout().items; const j = k + d; if (j < 0 || j >= items.length) return;
  [items[k], items[j]] = [items[j], items[k]]; persist(); render();
}

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('#tabs button');
  if (tabBtn) return setTab(tabBtn.dataset.tab);
  const unitChip = e.target.closest('#w-unit .chip');
  if (unitChip) { document.querySelectorAll('#w-unit .chip').forEach((c) => c.classList.toggle('on', c === unitChip)); return; }
  const b = e.target.closest('[data-action]');
  if (b && actions[b.dataset.action] && !b.disabled) actions[b.dataset.action](b);
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.classList.contains('set-val')) {
    const set = curSession()?.items[Number(t.dataset.i)]?.sets[Number(t.dataset.j)]; if (!set) return;
    set.value = t.value === '' ? null : Math.max(0, Math.round(Number(t.value))); persistSoon();
  } else if (t.classList.contains('comment')) {
    curSession().items[Number(t.dataset.i)].comment = t.value.slice(0, 2000); persistSoon();
  } else if (t.id === 'sess-note') { curSession().note = t.value.slice(0, 2000); persistSoon(); }
  else if (t.id === 'w-name') { curWorkout().name = t.value.trim() || 'Séance'; persistSoon(); }
  else if (t.dataset.field === 'target') { curWorkout().items[Number(t.dataset.k)].target = t.value.slice(0, 40); persistSoon(); }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.field === 'rest') { curWorkout().items[Number(t.dataset.k)].rest = Number(t.value); persist(); }
  else if (t.id === 'sess-date' && /^\d{4}-\d{2}-\d{2}$/.test(t.value)) { curSession().date = t.value; persist(); }
  else if (t.id === 'set-goal') { state.settings.weeklyGoal = Number(t.value); persist(); }
  else if (t.id === 'import' && t.files?.[0]) {
    try {
      const next = L.validateState(JSON.parse(await t.files[0].text()));
      if (!confirm(`Remplacer les données de cette appli par ce fichier (${next.sessions.length} séance(s)) ?`)) return;
      state = next; await persist(); toast('Données importées', 'success'); render();
    } catch (err) { toast(err.message || 'Fichier illisible', 'error'); }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { if (saveTimer) persist(); if (ls.get(K.dirty)) doSync(); }
  else { drawTimer(); updateElapsed(); pullRemote(); }
  syncWakeLock();
});

function watchUpdates() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !state.timer) location.reload(); });
  navigator.serviceWorker.register('sw.js', { scope: './' }).then((reg) => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
}

async function init() {
  state = await loadState();
  if (state.active) { view = { type: 'session', id: state.active }; }
  render();
  if (ls.get(K.dirty)) await doSync();
  await pullRemote();
  watchUpdates();
}
init();
