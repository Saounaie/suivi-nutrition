import {
  MEALS, MACROS, emptyMacros, macrosFor, totals, remaining, mealOfHour, parseNumber, todayISO, shiftDate,
  searchFoods, validateState, uid, dayStatus, weekOf, reconcileEntries,
  ZONES, addStock, deductStock, stockOf, daysLeft, findByBarcode, normalizeBarcode,
  upsertBody, movingAverage, weekStats, daysSinceMeasure, suggestMeals, recentFoods, lastGrams,
} from './logic.js';
import { GOALS, ACTIVITY, PACES, ageOf, validateProfile, estimate, weeksToGoal } from './profile.js';
import { loadState, saveState, askPersistent } from './store.js';
import { startScanner } from './scanner.js';
import { isSeedFood } from './seed.js';
import { lookupBarcode } from './off.js';
import { pushSnapshot, fetchSnapshot, dataSize, validRepo } from './sync.js';
import { APP_VERSION } from './version.js';
import { sfx, setSoundEnabled } from './sound.js';
import {
  computeStats, TROPHIES, TROPHY_GROUPS, trophyProgress, unlockedTrophies, levelOf,
  pickMessage, seedOf, situation, weekRecap, goalKey, goalEta,
} from './motivation.js';

let state;
let tab = 'today';
let date = todayISO();
let query = '';

const $ = (s) => document.querySelector(s);
const view = $('#view');
const sheet = $('#sheet');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null ? '?' : String(Math.round(n * 10) / 10).replace('.', ','));
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
const foodById = (id) => state.foods.find((f) => f.id === id);

function toast(msg, sound = 'success') {
  if (sound && sfx[sound]) sfx[sound]();
  const t = $('#toast');
  t.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span></span>';
  t.lastChild.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('show'), 2500);
}

async function persist() {
  const ok = await saveState(state);
  if (!ok) toast("Enregistrement impossible : exporte tes données.", 'error');
  scheduleSync();
  setTimeout(checkProgress, 350);
}

/* ---------- Motivation : trophées et petits encouragements ---------- */
const tone = () => state.settings.tone || 'mix';
const msg = (key, seedStr, vars) => pickMessage(key, seedOf(seedStr), tone(), vars);
const announced = new Set();
let pendingPop = [];

function markDayAnnounced() {
  const today = todayISO();
  if (totals(state.entries.filter((e) => e.date === today)).prot >= state.settings.prot) announced.add(`${today}:prot`);
}

/** Débloque les nouveaux trophées (une seule fois chacun) et félicite pour l'objectif de protéines du jour. */
async function checkProgress() {
  const today = todayISO();
  state.trophies = state.trophies || {};
  const fresh = unlockedTrophies(computeStats(state, today)).filter((id) => !(id in state.trophies));
  if (fresh.length) {
    for (const id of fresh) state.trophies[id] = today;
    await saveState(state); scheduleSync();
    pendingPop.push(...fresh);
  }
  const key = `${today}:prot`;
  const protHit = !announced.has(key) && totals(state.entries.filter((e) => e.date === today)).prot >= state.settings.prot;
  if (protHit) announced.add(key);
  if (pendingPop.length) showPop();
  else if (protHit) toast(msg('protGoal', key), 'goal');
}

function showPop() {
  if (sheet.open || document.body.classList.contains('wz-open') || !pendingPop.length) return;
  const ids = [...new Set(pendingPop)]; pendingPop = [];
  const list = ids.map((id) => TROPHIES.find((t) => t.id === id)).filter(Boolean);
  if (!list.length) return;
  const el = $('#trophy-pop');
  const names = list.length <= 2 ? list.map((t) => esc(t.name)).join(' · ') : 'Grâce à ton historique';
  el.innerHTML = `<div class="pop-card"><div class="pop-icon">${list.length === 1 ? list[0].icon : '🏆'}</div>
    <div><b>${list.length === 1 ? 'Trophée débloqué !' : `${list.length} trophées débloqués !`}</b><span>${names}</span></div>
    ${list.length > 1 ? '<button type="button" class="pop-btn" data-action="open-trophies">Voir</button>' : ''}</div>`;
  if (!reduceMotion()) {
    const colors = ['#6ee7a8', '#ffb454', '#6aa8ff', '#b79cff', '#f2d56b', '#ff7a7a'];
    el.insertAdjacentHTML('beforeend', Array.from({ length: 28 }, (_, i) =>
      `<i class="confetti" style="--x:${Math.round((Math.random() - .5) * 320)}px;--r:${Math.round(Math.random() * 720 - 360)}deg;--d:${(1.4 + Math.random() * 1.2).toFixed(2)}s;--w:${(Math.random() * .25).toFixed(2)}s;background:${colors[i % colors.length]}"></i>`).join(''));
  }
  el.classList.add('show');
  sfx.goal();
  clearTimeout(showPop.h);
  showPop.h = setTimeout(() => el.classList.remove('show'), 4600);
}
$('#trophy-pop').addEventListener('click', () => $('#trophy-pop').classList.remove('show'));
sheet.addEventListener('close', () => setTimeout(showPop, 250));

/** Messages et séries du jour, affichés en haut du journal. */
function cheerHTML() {
  const today = todayISO();
  const st = computeStats(state, today);
  const entries = state.entries.filter((e) => e.date === today);
  const t = totals(entries);
  const sit = situation({ hour: new Date().getHours(), count: entries.length, kcal: t.kcal, budget: state.settings.kcal, prot: t.prot, protGoal: state.settings.prot, streak: st.log.current, daysAway: st.daysAway });
  const text = msg(sit.key, `${today}:${sit.key}`, sit.vars);
  const chips = [
    st.log.current >= 1 ? `<span class="streak-chip">🔥 ${plural(st.log.current, 'jour')} de suivi</span>` : '',
    st.budget.current >= 1 ? `<span class="streak-chip">🎯 ${plural(st.budget.current, 'jour')} dans le budget</span>` : '',
    st.log.current >= 2 ? `<span class="streak-chip dim" title="Un jour raté par semaine ne casse pas ta série">🃏 ${st.log.jokerLeft ? 'Joker dispo' : 'Joker pris'}</span>` : '',
  ].join('');
  return `<div class="cheer"><p>${esc(text)}</p>${chips ? `<div class="streaks">${chips}</div>` : ''}</div>`;
}

/** Rappel d'export, repoussable : remplace l'ancien message qui recouvrait la liste des repas. */
function exportNagHTML() {
  const last = localStorage.getItem('lastExport');
  const due = state.entries.length > 20 && (!last || Date.now() - new Date(last) > 14 * 864e5);
  if (!due || Date.now() < (ls.get('exportNagUntil') || 0)) return '';
  return `<div class="alert nag"><span>Pense à exporter tes données : elles ne sont que sur ce téléphone.</span>
    <div class="row"><button class="btn" data-action="goto-settings">Exporter</button><button class="icon-btn" data-action="nag-later">Plus tard</button></div></div>`;
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
  setSoundEnabled(state.settings.sounds !== false);
}

function dateLabel(iso) {
  const d = new Date(iso + 'T12:00:00');
  const txt = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return iso === todayISO() ? `Aujourd'hui · ${txt}` : txt;
}

/* ---------- Écran Aujourd'hui ---------- */
function renderToday() {
  const entries = state.entries.filter((e) => e.date === date);
  const t = totals(entries);
  const left = remaining(state.settings.kcal, entries);
  const pct = Math.min(100, Math.round((t.kcal / state.settings.kcal) * 100));
  const plusIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const chev = '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  const meals = MEALS.map((m) => {
    const list = entries.filter((e) => e.meal === m.id);
    const mt = totals(list);
    return `
      <div class="meal-head"><b>${m.label}</b><span>${list.length ? `${mt.kcal} kcal · ${fmt(mt.prot)} g prot` : ''}${list.some((e) => e.foodId) ? ` <button type="button" class="star-btn" data-action="save-meal" data-meal="${m.id}" aria-label="Enregistrer ce repas">☆</button>` : ''}</span></div>
      <div class="list">
        ${list.map((e) => `
          <button type="button" class="item ${e.id === lastAddedId ? 'new' : ''}" data-action="entry-menu" data-id="${esc(e.id)}">
            <span>${esc(e.label)}<br><span class="sub">${e.grams ? fmt(e.grams) + ' g · ' : ''}${e.kcal} kcal · ${fmt(e.prot)} g prot</span></span>
            ${chev}
          </button>`).join('')}
        <button type="button" class="item add-row" data-action="add" data-meal="${m.id}">${plusIcon}<span>${list.length ? 'Ajouter' : 'Ajouter un aliment'}</span></button>
      </div>`;
  }).join('');
  const isPast = date < todayISO();
  const st = dayStatus(t.kcal, state.settings.kcal, isPast);
  const stText = { empty: 'Journée vide', ok: 'Dans ton budget', low: 'Un peu bas pour la journée', high: 'Légèrement au-dessus', over: 'Nettement au-dessus' }[st];
  const dayNames = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
  const week = weekOf(date).map((iso, i) => {
    const k = totals(state.entries.filter((e) => e.date === iso)).kcal;
    const s2 = dayStatus(k, state.settings.kcal, iso < todayISO());
    return `<button type="button" class="day s-${s2}" data-action="goto" data-date="${iso}" aria-pressed="${iso === date}" ${iso === todayISO() ? 'aria-current="date"' : ''} aria-label="${iso}">${dayNames[i]}<b>${Number(iso.slice(8))}</b><i></i></button>`;
  }).join('');
  const C = 2 * Math.PI * 52;
  const ringTarget = C * (1 - Math.min(1, t.kcal / state.settings.kcal));
  const kcalFromMacros = t.prot * 4 + t.carbs * 4 + t.fat * 9;
  const share = (g, k) => (kcalFromMacros > 0 ? Math.round(((g * k) / kcalFromMacros) * 100) : 0);
  const protPct = Math.min(100, Math.round((t.prot / state.settings.prot) * 100));
  const fibPct = Math.min(100, Math.round((t.fiber / 30) * 100));
  const mrow = (cls, color, name, val, extra, pct) => `<div class="mrow" style="--dot:${color}"><span class="name">${name}</span><span class="val">${val}${extra ? ` <small>${extra}</small>` : ''}</span><div class="bar ${cls}"><i style="width:${pct}%"></i></div></div>`;
  view.innerHTML = `
    <div class="row between">
      <h1>Journal</h1>
      <button class="icon-btn" data-action="today-btn" ${date === todayISO() ? 'hidden' : ''}>Aujourd'hui</button>
    </div>
    <div class="muted small" style="margin-top:4px">${esc(dateLabel(date))}</div>
    <div class="week">${week}</div>
    ${date === todayISO() ? cheerHTML() : ''}
    ${exportNagHTML()}
    <div class="card hero s-${st}">
      <div class="hero-top">
        <div class="ring" role="img" aria-label="${t.kcal} kcal sur ${state.settings.kcal}">
          <svg viewBox="0 0 120 120"><circle class="ring-bg" cx="60" cy="60" r="52"/><circle class="ring-fg" id="ring" cx="60" cy="60" r="52" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-target="${ringTarget}"/></svg>
          <div class="ring-num"><span class="big" id="kcal-num" data-to="${Math.abs(left)}">${Math.abs(left)}</span><span class="small muted">${left >= 0 ? 'kcal restantes' : 'au-dessus du budget'}</span></div>
        </div>
        <div class="hero-side">
          <span class="eaten">${t.kcal}</span>
          <span class="small muted">sur ${state.settings.kcal} kcal</span>
          <span class="chip-status">${stText}</span>
        </div>
      </div>
      <div class="macro-rows">
        ${mrow('prot', 'var(--c-prot)', 'Protéines', `${fmt(t.prot)} g`, `/ ${state.settings.prot} g`, protPct)}
        ${mrow('carb', 'var(--c-carb)', 'Glucides', `${fmt(t.carbs)} g`, `${share(t.carbs, 4)} % des kcal`, share(t.carbs, 4))}
        ${mrow('fat', 'var(--c-fat)', 'Lipides', `${fmt(t.fat)} g`, `${share(t.fat, 9)} % des kcal`, share(t.fat, 9))}
        ${mrow('fib', 'var(--c-fib)', 'Fibres', `${fmt(t.fiber)} g`, 'repère 30 g', fibPct)}
      </div>
    </div>
    ${meals}
    <button class="fab" data-action="add" aria-label="Ajouter un aliment"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>`;
  animateHero(left, C, ringTarget);
}

let lastLeft = null, lastAddedId = null;
function markNew() { lastAddedId = state.entries[state.entries.length - 1]?.id || null; setTimeout(() => { lastAddedId = null; }, 1600); }
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function animateHero(left, C, target) {
  const ring = $('#ring'), num = $('#kcal-num');
  if (!ring || !num) return;
  if (reduceMotion()) { ring.style.strokeDashoffset = target; lastLeft = Math.abs(left); return; }
  requestAnimationFrame(() => requestAnimationFrame(() => { ring.style.strokeDashoffset = target; }));
  const from = lastLeft ?? 0, to = Math.abs(left);
  lastLeft = to;
  if (from === to) return;
  const t0 = performance.now(), dur = 900;
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    num.textContent = Math.round(from + (to - from) * e);
    if (k < 1 && document.body.contains(num)) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ---------- Écran Aliments ---------- */
const seedCleanable = () => state.foods.filter((f) => isSeedFood(f)
  && !state.entries.some((e) => e.foodId === f.id) && !state.stock.some((x) => x.foodId === f.id));

function renderFoods() {
  const foods = searchFoods(state.foods, query);
  view.innerHTML = `
    <div class="row between"><h1>Aliments</h1><div class="row"><button class="btn" data-action="scan" data-mode="catalog">Scanner</button><button class="btn primary" data-action="food-new">+ Nouveau</button></div></div>
    <label style="margin-top:14px">Rechercher<input type="search" id="q" value="${esc(query)}" placeholder="skyr, frites, code-barres…" autocomplete="off"></label>
    ${seedCleanable().length ? `<div class="alert"><b>${seedCleanable().length} aliment${seedCleanable().length > 1 ? 's' : ''} d'exemple</b> créé${seedCleanable().length > 1 ? 's' : ''} automatiquement par les premières versions.<br><button class="btn block" style="margin-top:10px" data-action="clean-seed">Les supprimer (ceux que tu n'as jamais utilisés)</button></div>` : ''}
    <h2>${foods.length} aliment${foods.length > 1 ? 's' : ''}</h2>
    <div class="list">
      ${foods.map((f) => `
        <button type="button" class="item" data-action="food-edit" data-id="${esc(f.id)}">
          <span>${esc(f.name)}${f.brand ? ` <span class="muted">· ${esc(f.brand)}</span>` : ''}<br>
            <span class="sub">${fmt(f.per100.kcal)} kcal · ${fmt(f.per100.prot)} g prot /100 g</span></span>
          ${f.per100.kcal == null || f.per100.prot == null ? '<span class="pill warn">à compléter</span>' : ''}
        </button>`).join('') || '<div class="item"><span class="sub">Aucun résultat</span></div>'}
    </div>`;
  const q = $('#q');
  q.addEventListener('input', () => { query = q.value; const pos = q.selectionStart; renderFoods(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
}


/* ---------- Écran Frigo ---------- */
function dlcPill(dlc) {
  const d = daysLeft(dlc, todayISO());
  if (d == null) return '';
  if (d < 0) return '<span class="pill red">DLC dépassée</span>';
  if (d <= 2) return `<span class="pill warn">DLC ${d === 0 ? "aujourd'hui" : 'dans ' + d + ' j'}</span>`;
  return `<span class="pill">DLC ${new Date(dlc + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>`;
}

function renderStock() {
  const items = state.stock.map((x) => ({ ...x, food: foodById(x.foodId) })).filter((x) => x.food);
  const soon = items.filter((x) => { const d = daysLeft(x.dlc, todayISO()); return d != null && d <= 2; })
    .sort((a, b) => a.dlc.localeCompare(b.dlc));
  const zones = ZONES.map((z) => {
    const list = items.filter((x) => x.zone === z.id).sort((a, b) => a.food.name.localeCompare(b.food.name, 'fr'));
    if (!list.length) return '';
    return `<h2>${z.label}</h2><div class="list">${list.map((x) => `
      <button type="button" class="item" data-action="stock-edit" data-id="${esc(x.id)}">
        <span>${esc(x.food.name)}<br><span class="sub">${fmt(x.grams)} g${x.food.per100.kcal != null ? ' · ' + Math.round(x.food.per100.kcal * x.grams / 100) + ' kcal en stock' : ''}</span></span>
        ${dlcPill(x.dlc)}
      </button>`).join('')}</div>`;
  }).join('');
  view.innerHTML = `
    <div class="row between"><h1>Frigo</h1><button class="btn primary" data-action="courses">+ Courses</button></div>
    ${soon.length ? `<div class="alert ${soon.some((x) => daysLeft(x.dlc, todayISO()) < 0) ? 'red' : ''}">À consommer vite : ${soon.map((x) => esc(x.food.name)).join(', ')}</div>` : ''}
    ${zones || '<div class="card muted" style="margin-top:16px">Ton stock est vide. Touche « + Courses » pour ajouter ce que tu viens d\'acheter.</div>'}
    ${ideasHTML()}
    <p class="small muted" style="margin-top:18px">Quand tu ajoutes un repas, la quantité est retirée du stock automatiquement (frigo d'abord, puis placard et congélateur).</p>`;
}


let ideas = [];
function ideasHTML() {
  const entries = state.entries.filter((e) => e.date === todayISO());
  const left = remaining(state.settings.kcal, entries);
  const protLeft = Math.round(state.settings.prot - totals(entries).prot);
  ideas = suggestMeals(state.stock, state.foods, left, protLeft);
  if (!ideas.length) return left < 150 ? '' : '<p class="small muted" style="margin-top:16px">Pas d\'idée de repas : ajoute des aliments avec leurs kcal au stock.</p>';
  return `<h2>Idées de repas</h2><div class="small muted" style="margin:-2px 6px 4px">Il te reste ${left} kcal et ${Math.max(0, protLeft)} g de protéines aujourd'hui.</div>
    ${ideas.map((m, i) => `<div class="card" style="margin-top:10px">
      <div>${m.items.map((c) => `${esc(c.food.name)} ${fmt(c.grams)} g`).join(' + ')}</div>
      <div class="small muted" style="margin:4px 0 10px">${m.kcal} kcal · ${fmt(m.prot)} g prot</div>
      <button class="btn block" data-action="idea-add" data-i="${i}">Ajouter à mon journal</button></div>`).join('')}`;
}

async function logIdea(i) {
  const m = ideas[i]; if (!m) return;
  const meal = mealOfHour(new Date().getHours());
  for (const c of m.items) {
    const zone = state.stock.filter((x) => x.foodId === c.food.id).sort((a, b) => ({ frigo: 0, placard: 1, congel: 2 })[a.zone] - ({ frigo: 0, placard: 1, congel: 2 })[b.zone])[0]?.zone || 'frigo';
    const d = deductStock(state.stock, c.food.id, c.grams);
    state.entries.push({ id: uid(), date: todayISO(), meal, foodId: c.food.id, label: c.food.name, grams: c.grams, deducted: d.deducted, zone, ...c.m });
  }
  markNew(); await persist(); render(); toast('Ajouté au journal · retiré du stock');
}

function sheetStockItem(id) {
  const x = state.stock.find((s) => s.id === id); if (!x) return;
  const f = foodById(x.foodId);
  openSheet(`
    <header><h3>${esc(f.name)}</h3><button class="icon-btn" data-action="close">Fermer</button></header>
    <div class="grid2">
      <label>Quantité restante (g)<input type="text" inputmode="decimal" id="sg" value="${String(x.grams).replace('.', ',')}"></label>
      <label>Emplacement<select id="sz">${ZONES.map((z) => `<option value="${z.id}" ${z.id === x.zone ? 'selected' : ''}>${z.label}</option>`).join('')}</select></label>
    </div>
    <label>DLC (facultatif)<input type="date" id="sd" value="${x.dlc || ''}"></label>
    <div id="serr" class="small" style="color:var(--danger)"></div>
    <button class="btn primary block" id="save">Enregistrer</button>
    <button class="btn danger block" id="del">Retirer du stock</button>`);
  $('#save').addEventListener('click', async () => {
    const g = parseNumber($('#sg').value);
    if (!(g >= 0)) { $('#serr').textContent = 'Quantité invalide.'; return; }
    x.grams = g; x.zone = $('#sz').value; x.dlc = $('#sd').value || null;
    if (g === 0) state.stock = state.stock.filter((s) => s.id !== id);
    await persist(); closeSheet(); render();
  });
  $('#del').addEventListener('click', async () => { state.stock = state.stock.filter((s) => s.id !== id); await persist(); closeSheet(); render(); toast('Retiré du stock', 'remove'); });
}

/** Mode courses : on ajoute les produits un par un sans fermer la feuille. */
function sheetCourses(zone = 'frigo', picked = null) {
  if (picked) {
    const f = foodById(picked);
    const presets = [...f.portions.map((p) => p.grams), 250, 500, 1000, 2500].filter((v, i, a) => a.indexOf(v) === i).slice(0, 6);
    openSheet(`
      <header><h3>${esc(f.name)}</h3><button class="icon-btn" data-action="courses-back" data-zone="${zone}">Retour</button></header>
      <div class="small muted">En stock : ${fmt(stockOf(state.stock, f.id))} g</div>
      <label>Quantité achetée (g)<input type="text" inputmode="decimal" id="cg" value="" placeholder="ex. 2500" autocomplete="off"></label>
      <div class="chips">${presets.map((v) => `<button type="button" class="chip" data-g="${v}">${fmt(v)} g</button>`).join('')}</div>
      <div class="grid2">
        <label>Emplacement<select id="cz">${ZONES.map((z) => `<option value="${z.id}" ${z.id === zone ? 'selected' : ''}>${z.label}</option>`).join('')}</select></label>
        <label>DLC (facultatif)<input type="date" id="cd"></label>
      </div>
      <div id="cerr" class="small" style="color:var(--danger)"></div>
      <button class="btn primary block" id="confirm">Ajouter au stock</button>`);
    document.querySelectorAll('.chip[data-g]').forEach((c) => c.addEventListener('click', () => { $('#cg').value = c.dataset.g; }));
    $('#confirm').addEventListener('click', async () => {
      const g = parseNumber($('#cg').value);
      if (!(g > 0)) { $('#cerr').textContent = 'Indique une quantité en grammes.'; return; }
      const z = $('#cz').value;
      addStock(state.stock, { foodId: f.id, grams: g, zone: z, dlc: $('#cd').value || null });
      await persist(); render(); toast(`Ajouté : ${f.name} ${fmt(g)} g`);
      sheetCourses(z);
    });
    return;
  }
  openSheet(`
    <header><h3>Courses</h3><button class="icon-btn" data-action="close">Terminé</button></header>
    <div class="small muted">Choisis un produit, indique la quantité, et enchaîne.</div>
    <button class="btn primary block" data-action="scan" data-mode="courses" data-zone="${zone}">Scanner un code-barres</button>
    <button class="btn block" data-action="food-new-courses" data-zone="${zone}">+ Nouvel aliment</button>
    <label>Rechercher<input type="search" id="cq" placeholder="skyr, poulet…" autocomplete="off"></label>
    <div class="list" id="clist"></div>`);
  const input = $('#cq'), list = $('#clist');
  const draw = () => {
    list.innerHTML = searchFoods(state.foods, input.value).map((f) => `
      <button type="button" class="item" data-action="courses-pick" data-id="${esc(f.id)}" data-zone="${zone}">
        <span>${esc(f.name)}<br><span class="sub">${fmt(stockOf(state.stock, f.id))} g en stock</span></span>
      </button>`).join('') || '<div class="item"><span class="sub">Aucun résultat</span></div>';
  };
  input.addEventListener('input', draw); draw();
}


/* ---------- Écran Suivi ---------- */
let chartDays = 90, showAllTrophies = false;

function chartSVG(points, goal = null) {
  const pts = chartDays ? points.filter((p) => p.date >= shiftDate(todayISO(), -chartDays)) : points;
  if (pts.length < 2) return `<p class="muted small" style="margin:8px 0 0">${points.length < 2 ? 'La courbe apparaît dès la deuxième pesée.' : 'Pas assez de pesées sur cette période.'}</p>`;
  const avg = movingAverage(pts, 7);
  const W = 340, H = 170, L = 34, R = 8, T = 10, B = 22;
  const vals = pts.map((p) => p.value).concat(avg.map((p) => p.value));
  const near = goal != null && goal >= Math.min(...vals) - 4 && goal <= Math.max(...vals) + 4;
  if (near) vals.push(goal);
  const lo = Math.floor((Math.min(...vals) - 0.3) * 2) / 2, hi = Math.ceil((Math.max(...vals) + 0.3) * 2) / 2;
  const t0 = new Date(pts[0].date + 'T12:00:00').getTime(), t1 = new Date(pts[pts.length - 1].date + 'T12:00:00').getTime();
  const x = (d) => L + ((new Date(d + 'T12:00:00').getTime() - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / Math.max(0.1, hi - lo)) * (H - T - B);
  const ticks = [lo, (lo + hi) / 2, hi];
  const fd = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbe de poids, de ${fmt(pts[0].value)} à ${fmt(pts[pts.length - 1].value)} kg">
    ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${fmt(v)}</text>`).join('')}
    ${near ? `<line class="goal-line" x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}"/><text class="goal-txt" x="${W - R}" y="${y(goal) - 4}" text-anchor="end">Objectif ${fmt(goal)}</text>` : ''}
    ${pts.map((p) => `<circle class="raw" cx="${x(p.date)}" cy="${y(p.value)}" r="2.5"/>`).join('')}
    <polyline class="avg" points="${avg.map((p) => `${x(p.date)},${y(p.value)}`).join(' ')}"/>
    <text x="${L}" y="${H - 6}">${fd(pts[0].date)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${fd(pts[pts.length - 1].date)}</text>
  </svg>`;
}

const unlockedIds = () => TROPHIES.filter((t) => t.id in (state.trophies || {})).map((t) => t.id);

function levelHTML() {
  const n = unlockedIds().length, lv = levelOf(n);
  return `<div class="card level">
    <div class="row between"><div><span class="small muted">Ton niveau</span><b class="lv-name">${esc(lv.name)}</b></div><span class="lv-rank">${lv.rank}</span></div>
    <div class="bar"><i style="width:${Math.round(lv.pct * 100)}%"></i></div>
    <div class="small muted">${n} / ${TROPHIES.length} trophées${lv.next ? ` · encore ${lv.next.need} pour « ${esc(lv.next.name)} »` : ' · niveau maximum atteint'}</div>
  </div>`;
}

function goalHTML(st) {
  const g = state.settings.goalWeight;
  if (!g) return `<h2>Objectif</h2><div class="card stack"><p class="small muted" style="margin:0">Fixe un poids cible : l'appli suit ta progression et t'encourage en chemin.</p><button class="btn primary block" data-action="goal">Définir mon objectif</button></div>`;
  const edit = '<button class="btn block" data-action="goal">Modifier l\'objectif</button>';
  if (st.startWeight == null || st.curAvg == null) return `<h2>Objectif</h2><div class="card stack"><div>Poids cible : <b>${fmt(g)} kg</b></div><div class="small muted">Enregistre une première pesée pour suivre ta progression.</div>${edit}</div>`;
  if (st.goal == null) return `<h2>Objectif</h2><div class="card stack"><div class="small warn">Ton poids cible (${fmt(g)} kg) doit être différent de ton poids de départ (${fmt(st.startWeight)} kg).</div>${edit}</div>`;
  const gain = g > st.startWeight;
  const left = Math.max(0, Math.round((gain ? g - st.curAvg : st.curAvg - g) * 10) / 10), pct = Math.round(st.goalFrac * 100);
  const text = msg(goalKey(st.goalFrac), `goal:${weekOf(todayISO())[0]}`, { left: fmt(left) });
  const eta = left > 0 ? goalEta(state.body.filter((b) => b.weight != null).map((b) => ({ date: b.date, value: b.weight })), g, todayISO()) : null;
  const etaTxt = eta ? `À ce rythme (${eta.perWeek > 0 ? '+' : ''}${fmt(eta.perWeek)} kg par semaine) : objectif vers le ${new Date(eta.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}.` : '';
  return `<h2>Objectif</h2><div class="card stack">
    <div class="row between"><span class="small muted">Départ ${fmt(st.startWeight)} kg</span><b>${pct} %</b><span class="small muted">Cible ${fmt(g)} kg</span></div>
    <div class="bar goal"><i style="width:${pct}%"></i></div>
    <div>${esc(text)}</div>
    <div class="small muted">Poids actuel (moyenne 7 jours) : ${fmt(st.curAvg)} kg${left > 0 ? ` · reste ${fmt(left)} kg` : ''}</div>
    ${etaTxt ? `<div class="eta">🗓️ ${etaTxt}</div>` : ''}
    ${edit}</div>`;
}

function recapHTML() {
  const today = todayISO(), r = weekRecap(state, today);
  const lines = r.days ? [
    `<li><b>${r.protDays}</b> ${r.protDays > 1 ? 'jours' : 'jour'} avec l'objectif de protéines atteint</li>`,
    r.trend != null ? `<li>Poids (moyenne) : <b class="${r.trend <= 0 ? 'down' : 'up'}">${r.trend > 0 ? '+' : ''}${fmt(r.trend)} kg</b> en 7 jours</li>` : '',
  ].join('') : '';
  return `<h2>Ta semaine</h2><div class="card"><p class="recap-msg">${esc(msg(r.key, `${weekOf(today)[0]}:${r.key}`))}</p>${lines ? `<ul class="recap">${lines}</ul>` : ''}</div>`;
}

function trophyCard(t, st) {
  const done = t.id in (state.trophies || {}), p = trophyProgress(t, st);
  return `<button type="button" class="trophy ${done ? 'done' : 'locked'}" data-action="trophy" data-id="${t.id}">
      <span class="t-ico">${t.icon}</span><span class="t-name">${esc(t.name)}</span>
      ${done ? '<span class="t-ok">Débloqué</span>' : `<div class="bar"><i style="width:${Math.round((p.value / p.target) * 100)}%"></i></div>`}</button>`;
}

/** Les trophées : les 3 plus proches d'être débloqués par défaut, la vitrine complète sur demande. */
function trophiesHTML(st) {
  const have = state.trophies || {};
  const soon = TROPHIES.filter((t) => !(t.id in have) && !(t.id.startsWith('goal') && !state.settings.goalWeight))
    .map((t) => ({ t, r: trophyProgress(t, st).value / t.target }))
    .sort((a, b) => b.r - a.r).slice(0, 3).map((x) => x.t);
  const toggle = `<button class="btn block" style="margin-top:12px" data-action="trophies-toggle">${showAllTrophies ? 'Réduire' : `Voir tous les trophées (${unlockedIds().length} / ${TROPHIES.length})`}</button>`;
  if (!showAllTrophies) return `<h2 id="trophies-top">Prochains trophées</h2><div class="trophies">${soon.map((t) => trophyCard(t, st)).join('') || '<div class="card muted" style="grid-column:1/-1">Tous les trophées sont débloqués. Bravo !</div>'}</div>${toggle}`;
  return `<span id="trophies-top"></span>${TROPHY_GROUPS.map((g) => `<h2>${g.label}</h2><div class="trophies">${TROPHIES.filter((t) => t.group === g.id).map((t) => trophyCard(t, st)).join('')}</div>`).join('')}${toggle}`;
}

function sheetTrophy(id) {
  const t = TROPHIES.find((x) => x.id === id); if (!t) return;
  const p = trophyProgress(t, computeStats(state, todayISO())), at = state.trophies?.[id];
  const needGoal = id.startsWith('goal') && !state.settings.goalWeight;
  openSheet(`
    <header><h3>${esc(t.name)}</h3><button class="icon-btn" data-action="close">Fermer</button></header>
    <div class="trophy-big ${at ? '' : 'locked'}">${t.icon}</div>
    <p style="text-align:center;margin:0">${esc(t.desc)}</p>
    ${at ? `<p class="small down" style="text-align:center;margin:0">Débloqué le ${new Date(at + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>`
      : `<div class="bar"><i style="width:${Math.round((p.value / p.target) * 100)}%"></i></div>
         <div class="small muted" style="text-align:center">${needGoal ? 'Fixe d\'abord un objectif de poids.' : `${fmt(p.value)} / ${fmt(p.target)}${t.unit ? ' ' + t.unit : ''}`}</div>`}`);
}

function sheetGoal() {
  const s = state.settings, firstW = state.body.find((b) => b.weight != null)?.weight ?? null;
  const val = (n) => (n == null ? '' : String(n).replace('.', ','));
  openSheet(`
    <header><h3>Objectif de poids</h3><button class="icon-btn" data-action="close">Fermer</button></header>
    <p class="small muted" style="margin:0">Indique ton poids de départ et le poids que tu vises (en dessous ou au-dessus, selon ton objectif).</p>
    <div class="grid2">
      <label>Poids de départ (kg)<input type="text" inputmode="decimal" id="g-start" value="${val(s.goalStart ?? firstW)}" placeholder="90" autocomplete="off"></label>
      <label>Poids cible (kg)<input type="text" inputmode="decimal" id="g-target" value="${val(s.goalWeight)}" placeholder="80" autocomplete="off"></label>
    </div>
    <div class="small muted">Départ laissé vide : ta première pesée sert de référence.</div>
    <div id="g-err" class="small" style="color:var(--danger)"></div>
    <button class="btn primary block" id="g-save">Enregistrer</button>
    ${s.goalWeight ? '<button class="btn danger block" id="g-del">Supprimer l\'objectif</button>' : ''}`);
  $('#g-save').addEventListener('click', async () => {
    const start = parseNumber($('#g-start').value), target = parseNumber($('#g-target').value);
    const from = start ?? firstW;
    if (Number.isNaN(start) || Number.isNaN(target) || target == null) { $('#g-err').textContent = 'Indique ton poids cible (nombre).'; return; }
    if (from == null) { $('#g-err').textContent = 'Indique ton poids de départ, ou enregistre d\'abord une pesée.'; return; }
    if (target < 30 || target > 300 || from < 30 || from > 300) { $('#g-err').textContent = 'Valeur peu plausible : vérifie la saisie.'; return; }
    if (target === from) { $('#g-err').textContent = 'Le poids cible doit être différent du poids de départ.'; return; }
    s.goalWeight = target; s.goalStart = start;
    await persist(); closeSheet(); render(); toast('Objectif enregistré');
  });
  $('#g-del')?.addEventListener('click', async () => {
    s.goalWeight = null; s.goalStart = null;
    await persist(); closeSheet(); render(); toast('Objectif supprimé', 'remove');
  });
}

function renderTrack() {
  const today = todayISO();
  const st = computeStats(state, today);
  const weights = state.body.filter((b) => b.weight != null).map((b) => ({ date: b.date, value: b.weight }));
  const last = weights[weights.length - 1], first = weights[0];
  const ago7 = [...weights].reverse().find((w) => w.date <= shiftDate(today, -6) || w === first);
  const delta = (a, b) => (a == null || b == null ? '' : `<span class="${a - b <= 0 ? 'down' : 'up'}">${a - b > 0 ? '+' : ''}${fmt(a - b)} kg</span>`);
  const ws = weekStats(state.entries, today, state.settings.kcal);
  const waistAge = daysSinceMeasure(state.body, 'waist', today);
  const todayRow = state.body.find((b) => b.date === today);
  const recent = [...state.body].reverse().slice(0, 10);
  view.innerHTML = `
    <h1>Suivi</h1>
    ${waistAge == null || waistAge >= 7 ? `<div class="alert">${waistAge == null ? 'Aucun tour de taille noté.' : `Dernier tour de taille il y a ${waistAge} jours.`} Mesure-le au nombril et prends ta photo de la semaine.</div>` : ''}
    ${levelHTML()}
    <h2>Mesure</h2>
    <div class="card stack">
      <label>Date<input type="date" id="b-date" value="${today}" max="${today}"></label>
      <div class="grid2">
        <label>Poids (kg)<input type="text" inputmode="decimal" id="b-w" value="${todayRow?.weight != null ? String(todayRow.weight).replace('.', ',') : ''}" placeholder="84,5"></label>
        <label>Tour de taille (cm)<input type="text" inputmode="decimal" id="b-t" value="${todayRow?.waist != null ? String(todayRow.waist).replace('.', ',') : ''}" placeholder="95"></label>
      </div>
      <div class="small muted">Pèse-toi le matin, après les toilettes, avant de manger, dans la même tenue.</div>
      <div id="b-err" class="small" style="color:var(--danger)"></div>
      <button class="btn primary block" id="b-save">Enregistrer</button>
    </div>
    <h2>Courbe de poids</h2>
    <div class="card">
      <div class="chips" style="margin-bottom:8px">${[[30, '30 j'], [90, '90 j'], [0, 'Tout']].map(([d, l]) => `<button type="button" class="chip ${chartDays === d ? 'on' : ''}" data-action="chart-range" data-days="${d}">${l}</button>`).join('')}</div>
      ${chartSVG(weights, state.settings.goalWeight)}<div class="small muted">Points : pesées · trait : moyenne sur 7 jours${state.settings.goalWeight ? ' · pointillés : objectif' : ''}</div></div>
    ${goalHTML(st)}
    <h2>Bilan</h2>
    <div class="stats">
      <div class="stat"><span class="small muted">Dernier poids</span><b>${last ? fmt(last.value) + ' kg' : '—'}</b></div>
      <div class="stat"><span class="small muted">Depuis la 1re pesée</span><b>${last && first && last !== first ? delta(last.value, first.value) : '—'}</b></div>
      <div class="stat"><span class="small muted">Sur 7 jours</span><b>${last && ago7 && ago7 !== last ? delta(last.value, ago7.value) : '—'}</b></div>
      <div class="stat"><span class="small muted">Jours dans le budget (7 j)</span><b>${ws.days ? `${ws.ok} / ${ws.days}` : '—'}</b></div>
      <div class="stat"><span class="small muted">Moyenne kcal (7 j)</span><b>${ws.days ? ws.kcal : '—'}</b></div>
      <div class="stat"><span class="small muted">Moyenne protéines (7 j)</span><b>${ws.days ? fmt(ws.prot) + ' g' : '—'}</b></div>
    </div>
    ${recapHTML()}
    ${trophiesHTML(st)}
    ${recent.length ? `<h2>Dernières mesures</h2><div class="list">${recent.map((b) => `
      <button type="button" class="item" data-action="body-del" data-id="${esc(b.id)}">
        <span>${new Date(b.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
        <span class="muted">${b.weight != null ? fmt(b.weight) + ' kg' : ''}${b.weight != null && b.waist != null ? ' · ' : ''}${b.waist != null ? fmt(b.waist) + ' cm' : ''}</span>
      </button>`).join('')}</div><p class="small muted">Touche une ligne pour la supprimer.</p>` : ''}`;
  $('#b-save').addEventListener('click', async () => {
    const date = $('#b-date').value || today, w = parseNumber($('#b-w').value), t = parseNumber($('#b-t').value);
    if (Number.isNaN(w) || Number.isNaN(t) || (w == null && t == null)) { $('#b-err').textContent = 'Indique un poids ou un tour de taille (nombre).'; return; }
    if ((w != null && (w < 30 || w > 300)) || (t != null && (t < 40 || t > 200))) { $('#b-err').textContent = 'Valeur peu plausible : vérifie la saisie.'; return; }
    upsertBody(state.body, { date, weight: w, waist: t });
    await persist(); render(); toast('Mesure enregistrée');
  });
}


/* ---------- Synchronisation vers un dépôt privé (lecture par Claude) ---------- */
const ls = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* ignore */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } },
};
let syncSha = null, syncTimer = null, syncBusy = false;

function scheduleSync() {
  const cfg = ls.get('syncCfg');
  if (!cfg?.token || !cfg?.repo) return;
  ls.set('syncDirty', true);
  clearTimeout(syncTimer);
  syncTimer = setTimeout(doSync, 4000);
}

async function doSync() {
  const cfg = ls.get('syncCfg');
  if (!cfg?.token || !cfg?.repo || syncBusy) return null;
  clearTimeout(syncTimer);
  syncBusy = true;
  const r = await pushSnapshot(cfg, state, fetch, syncSha);
  syncBusy = false;
  if (r.ok) { syncSha = r.sha; ls.del('syncDirty'); ls.set('syncStatus', { ok: true, at: new Date().toISOString() }); }
  else ls.set('syncStatus', { ok: false, at: new Date().toISOString(), message: r.message });
  if (tab === 'settings') showSyncInfo();
  return r;
}

function showSyncInfo() {
  const el = $('#sync-info'); if (!el) return;
  const cfg = ls.get('syncCfg'), st = ls.get('syncStatus');
  const when = st ? new Date(st.at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  el.innerHTML = !cfg?.token ? 'Synchronisation désactivée.'
    : st?.ok ? `<span class="down">Dernière copie réussie : ${esc(when)}</span>`
    : st ? `<span style="color:var(--danger)">Échec (${esc(when)}) : ${esc(st.message)}</span>`
    : 'En attente de la première copie.';
}

function bindSyncSettings() {
  const cfg = ls.get('syncCfg');
  $('#sync-repo').value = cfg?.repo || '';
  $('#sync-token').placeholder = cfg?.token ? '•••••••• (enregistré)' : 'github_pat_…';
  showSyncInfo();
  $('#sync-save').addEventListener('click', async () => {
    const repo = $('#sync-repo').value.trim(), token = $('#sync-token').value.trim() || cfg?.token || '';
    if (!validRepo(repo)) { toast('Dépôt invalide : écris-le sous la forme compte/nom', 'error'); return; }
    if (!token) { toast('Colle ton jeton GitHub', 'error'); return; }
    $('#sync-info').textContent = 'Vérification de la copie en ligne…';
    const remote = await fetchSnapshot({ repo, token });
    if (!remote.ok) { toast(remote.message, 'error'); $('#sync-info').textContent = remote.message; return; }
    if (remote.state) {
      let rs = null;
      try { rs = validateState(remote.state); } catch (_) { /* fichier illisible : on ne propose pas la restauration */ }
      if (rs && dataSize(rs) > dataSize(state)) {
        const msg = `La copie en ligne contient ${rs.foods.length} aliments, ${rs.entries.length} repas, ${rs.stock.length} lignes de stock et ${rs.body.length} mesures, contre ${state.foods.length} / ${state.entries.length} / ${state.stock.length} / ${state.body.length} sur cet appareil.\n\nOK = restaurer la copie en ligne sur cet appareil.\nAnnuler = ne pas restaurer.`;
        if (confirm(msg)) {
          state = rs; await saveState(state); applyTheme();
          ls.set('syncCfg', { repo, token }); $('#sync-token').value = '';
          const r2 = await doSync(); toast('Données restaurées', 'success'); renderSettings(); return r2;
        }
        if (!confirm("Remplacer la copie en ligne par les données de cet appareil ? Les données de la copie seront écrasées.")) { $('#sync-info').textContent = 'Synchronisation non activée.'; return; }
      }
    }
    ls.set('syncCfg', { repo, token }); $('#sync-token').value = '';
    $('#sync-info').textContent = 'Envoi en cours…';
    const r = await doSync();
    toast(r?.ok ? 'Synchronisation active' : (r?.message || 'Échec'), r?.ok ? 'success' : 'error');
    renderSettings();
  });
  $('#sync-off')?.addEventListener('click', () => {
    if (!confirm('Désactiver la synchronisation et effacer le jeton de cet appareil ? (Pense à le révoquer aussi sur GitHub.)')) return;
    ['syncCfg', 'syncStatus', 'syncDirty'].forEach(ls.del); syncSha = null; renderSettings();
  });
}

/* ---------- Profil et écran de bienvenue ---------- */
const latestWeight = () => [...state.body].reverse().find((b) => b.weight != null)?.weight ?? null;

function profileCardHTML() {
  const p = state.profile;
  if (!p) return `<h2>Mon profil</h2><div class="card stack"><p class="small muted" style="margin:0">Renseigne ta taille, ton poids et ton objectif : l'appli estime ton budget calorique et tes protéines.</p><button class="btn primary block" data-action="wizard">Calculer mon budget calorique</button></div>`;
  const w = latestWeight(), goal = GOALS.find((g) => g.id === p.goal), act = ACTIVITY.find((a) => a.id === p.activity);
  const est = w ? estimate(p, w) : null;
  const differs = est && (Math.abs(est.kcal - state.settings.kcal) >= 50 || est.prot !== state.settings.prot);
  return `<h2>Mon profil</h2><div class="card stack">
    <div class="prof-grid">
      <div class="wide"><span class="small muted">Objectif</span><b>${goal.icon} ${goal.label}</b></div>
      <div><span class="small muted">Taille</span><b>${fmt(p.height)} cm</b></div>
      <div><span class="small muted">Poids actuel</span><b>${w != null ? fmt(w) + ' kg' : '—'}</b></div>
      <div><span class="small muted">Âge</span><b>${ageOf(p.birthDate)} ans</b></div>
      <div><span class="small muted">Activité</span><b>${act.label}</b></div>
    </div>
    ${est ? `<div class="est-box"><span class="small muted">Budget conseillé aujourd'hui</span><b>${est.kcal} kcal · ${est.prot} g de protéines</b>
      <span class="small muted">Métabolisme de base ${est.bmr} kcal · dépense totale ${est.tdee} kcal</span></div>` : '<div class="small muted">Enregistre une pesée pour recalculer ton budget.</div>'}
    ${differs ? `<button class="btn primary block" data-action="apply-estimate">Appliquer ${est.kcal} kcal et ${est.prot} g de protéines</button><div class="small muted">Ton budget actuel : ${state.settings.kcal} kcal et ${state.settings.prot} g.</div>` : est ? '<div class="small down">Ton budget actuel correspond à l\'estimation.</div>' : ''}
    <button class="btn block" data-action="wizard">Modifier mon profil</button></div>`;
}

/** Formulaire en plusieurs étapes (plein écran) : bienvenue au premier lancement, puis modification du profil. */
function openWizard({ first = false } = {}) {
  const p = state.profile;
  const W = {
    first, step: first ? 'intro' : 'goal', goal: p?.goal ?? null, sex: p?.sex ?? null, birthDate: p?.birthDate ?? '',
    height: p?.height ?? '', weight: latestWeight() ?? '', target: state.settings.goalWeight ?? '',
    activity: p?.activity ?? null, pace: p?.pace ?? null, kcal: null, est: null, err: '',
  };
  const order = () => ['goal', 'you', 'body', 'activity', ...(W.goal === 'maintain' ? [] : ['pace']), 'result'];
  const num = (v) => parseNumber(String(v ?? ''));
  const profile = () => ({ sex: W.sex, birthDate: W.birthDate, height: num(W.height), activity: W.activity, goal: W.goal, pace: W.goal === 'maintain' ? null : W.pace });
  let el = $('#welcome');
  if (!el) { el = document.createElement('div'); el.id = 'welcome'; document.body.appendChild(el); }
  document.body.classList.add('wz-open');
  const close = () => { el.remove(); document.body.classList.remove('wz-open'); setTimeout(showPop, 300); };

  const check = () => {
    switch (W.step) {
      case 'goal': return W.goal ? '' : 'Choisis ton objectif pour continuer.';
      case 'you': {
        if (!W.sex) return 'Indique ton sexe : il sert au calcul du métabolisme.';
        const a = ageOf(W.birthDate);
        return a >= 14 && a <= 100 ? '' : 'Indique ta date de naissance (entre 14 et 100 ans).';
      }
      case 'body': {
        const h = num(W.height), w = num(W.weight), t = num(W.target);
        if (!(h >= 120 && h <= 230)) return 'Taille peu plausible (entre 120 et 230 cm).';
        if (!(w >= 30 && w <= 300)) return 'Poids peu plausible (entre 30 et 300 kg).';
        if (W.goal === 'maintain') return '';
        if (!(t >= 30 && t <= 300)) return 'Indique ton poids cible.';
        if (W.goal === 'loss' ? t >= w : t <= w) return W.goal === 'loss' ? 'Ton poids cible doit être inférieur à ton poids actuel.' : 'Ton poids cible doit être supérieur à ton poids actuel.';
        return '';
      }
      case 'activity': return W.activity ? '' : "Choisis ton niveau d'activité.";
      case 'pace': return W.pace ? '' : 'Choisis un rythme.';
      default: return '';
    }
  };

  const opts = (field, list) => `<div class="opts">${list.map((o) => `
    <button type="button" class="opt ${String(W[field]) === String(o.id) ? 'on' : ''}" data-opt="${field}" data-v="${o.id}">
      ${o.icon ? `<span class="opt-ico">${o.icon}</span>` : ''}<span class="opt-txt"><b>${o.label}</b><small>${o.desc}</small></span><span class="opt-check"></span>
    </button>`).join('')}</div>`;
  const field = (id, label, value, extra = '') => `<label class="wz-field">${label}<input type="text" inputmode="decimal" data-f="${id}" value="${esc(String(value ?? '').replace('.', ','))}" autocomplete="off" ${extra}></label>`;

  const content = () => {
    const w = num(W.weight);
    switch (W.step) {
      case 'intro': return `<div class="wz-hero"><div class="wz-logo">🥗</div><h1>Bienvenue</h1>
        <p>Quelques questions pour estimer précisément ton budget calorique et tes protéines, selon ton objectif.</p>
        <ul class="wz-points"><li><span>🔒</span>Tes données restent sur ton téléphone</li><li><span>⏱️</span>Moins de deux minutes</li><li><span>✏️</span>Modifiable à tout moment dans Réglages</li></ul></div>`;
      case 'goal': return `<h1>Quel est ton objectif ?</h1><p class="wz-sub">On adapte ton budget calorique à ce que tu vises.</p>${opts('goal', GOALS)}`;
      case 'you': return `<h1>Parlons de toi</h1><p class="wz-sub">Ces informations servent au calcul de ton métabolisme (formule de Mifflin-St Jeor).</p>
        <div class="wz-label">Sexe</div>
        <div class="seg">${[['f', 'Femme'], ['m', 'Homme']].map(([v, l]) => `<button type="button" class="${W.sex === v ? 'on' : ''}" data-opt="sex" data-v="${v}">${l}</button>`).join('')}</div>
        <label class="wz-field">Date de naissance<input type="date" data-f="birthDate" value="${esc(W.birthDate)}" min="1920-01-01" max="${todayISO()}"></label>`;
      case 'body': return `<h1>Tes mensurations</h1><p class="wz-sub">Pèse-toi le matin si possible : c'est la mesure la plus fiable.</p>
        <div class="grid2">${field('height', 'Taille (cm)', W.height, 'placeholder="175"')}${field('weight', 'Poids actuel (kg)', W.weight, 'placeholder="80"')}</div>
        ${W.goal !== 'maintain' ? field('target', 'Poids visé (kg)', W.target, `placeholder="${W.goal === 'loss' ? '72' : '85'}"`) : ''}`;
      case 'activity': return `<h1>Ton niveau d'activité</h1><p class="wz-sub">Compte ton quotidien et ton sport, sur une semaine typique.</p>${opts('activity', ACTIVITY)}`;
      case 'pace': return `<h1>À quel rythme ?</h1><p class="wz-sub">${W.goal === 'loss' ? 'Un rythme modéré se tient mieux dans la durée et préserve le muscle.' : 'Une prise lente limite la graisse en plus du muscle.'}</p>
        ${opts('pace', PACES[W.goal].map((x) => ({ id: x.v, label: x.label, desc: `${x.desc} · environ ${W.goal === 'loss' ? '−' : '+'}${Math.round(x.v * 1100)} kcal par jour` })))}`;
      case 'result': {
        const e = W.est, delta = Math.round((W.kcal - e.tdee) / 10) * 10 || 0, weeks = weeksToGoal(profile(), w, num(W.target));
        return `<div class="wz-result"><span class="wz-eyebrow">Ton budget quotidien</span>
          <div class="wz-big"><span id="wz-kcal">${W.kcal}</span><small>kcal</small></div>
          <div class="stepper"><button type="button" data-act="kcal-" aria-label="Moins 50 kcal">−</button><span>ajuster</span><button type="button" data-act="kcal+" aria-label="Plus 50 kcal">+</button></div>
          <div class="wz-rows">
            <div><span>Métabolisme de base</span><b>${e.bmr} kcal</b></div>
            <div><span>Dépense quotidienne</span><b>${e.tdee} kcal</b></div>
            <div><span>Écart avec ton objectif</span><b id="wz-delta">${delta > 0 ? '+' : ''}${delta} kcal</b></div>
            <div><span>Protéines conseillées</span><b>${e.prot} g</b></div>
          </div>
          ${weeks ? `<div class="wz-note">🎯 Environ <b>${weeks} semaine${weeks > 1 ? 's' : ''}</b> pour atteindre ${fmt(num(W.target))} kg à ce rythme.</div>` : ''}
          ${e.notes.map((n) => `<div class="wz-note warn">${esc(n)}</div>`).join('')}
          <p class="small muted">Estimation indicative, pas un avis médical. Après 2 à 3 semaines, ajuste selon l'évolution de ta courbe de poids.</p></div>`;
      }
      default: return '';
    }
  };

  const draw = (animate = true) => {
    const steps = order(), idx = steps.indexOf(W.step);
    const label = W.step === 'intro' ? 'Commencer' : W.step === 'result' ? "C'est parti" : 'Continuer';
    el.innerHTML = `
      <div class="wz-top">
        ${W.step === 'intro' ? '<span></span>' : '<button type="button" class="wz-round" data-act="back" aria-label="Retour">‹</button>'}
        ${W.step === 'intro' ? '<span></span>' : `<div class="wz-dots">${steps.map((s, i) => `<i class="${i <= idx ? 'on' : ''}"></i>`).join('')}</div>`}
        ${W.first ? '<span></span>' : '<button type="button" class="wz-round" data-act="cancel" aria-label="Fermer">✕</button>'}
      </div>
      <div class="wz-body ${animate ? 'wz-in' : ''}">${content()}</div>
      <div class="wz-foot">
        <div class="wz-err" id="wz-err">${esc(W.err)}</div>
        <button type="button" class="btn primary block wz-cta" data-act="next">${label}</button>
        ${W.step === 'intro' ? '<button type="button" class="wz-skip" data-act="skip">Passer pour l\'instant</button>' : ''}
      </div>`;
    el.querySelectorAll('[data-f]').forEach((i) => i.addEventListener('input', () => { W[i.dataset.f] = i.value; }));
    el.querySelector('.wz-body').scrollTop = 0;
    if (W.step === 'result' && animate && !reduceMotion()) countUp($('#wz-kcal'), W.kcal);
  };
  const go = (step) => {
    W.step = step; W.err = '';
    if (step === 'result') { W.est = estimate(profile(), num(W.weight)); W.kcal = W.est.kcal; }
    draw();
  };
  const finish = async () => {
    const pr = profile(), weight = num(W.weight), target = W.goal === 'maintain' ? null : num(W.target);
    const err = validateProfile(pr);
    if (err) { W.err = err; $('#wz-err').textContent = err; return; }
    const s = state.settings;
    state.profile = pr;
    s.kcal = W.kcal; s.prot = W.est.prot; s.onboarded = true;
    if (latestWeight() !== weight) upsertBody(state.body, { date: todayISO(), weight });
    if (target == null) { s.goalWeight = null; s.goalStart = null; }
    else if (s.goalWeight !== target) {
      const startOk = s.goalStart != null && (target < s.goalStart ? W.goal === 'loss' : W.goal === 'gain');
      s.goalWeight = target; s.goalStart = startOk ? s.goalStart : weight;
    }
    await persist(); close(); render(true); markDayAnnounced();
    toast(first ? 'Profil enregistré : ton budget est prêt' : 'Profil mis à jour');
  };
  const next = async () => {
    if (W.step === 'intro') return go('goal');
    const e = check();
    if (e) { W.err = e; $('#wz-err').textContent = e; sfx.error(); return; }
    if (W.step === 'result') return finish();
    const steps = order();
    go(steps[steps.indexOf(W.step) + 1]);
  };
  el.onclick = async (ev) => {
    const o = ev.target.closest('[data-opt]');
    if (o) {
      const f = o.dataset.opt, v = o.dataset.v;
      W[f] = f === 'pace' ? Number(v) : v; W.err = '';
      if (f === 'goal' && W.goal !== 'maintain' && !PACES[W.goal].some((x) => x.v === W.pace)) W.pace = null;
      el.querySelectorAll(`[data-opt="${f}"]`).forEach((b) => b.classList.toggle('on', b === o));
      $('#wz-err').textContent = ''; sfx.tap(); return;
    }
    const a = ev.target.closest('[data-act]')?.dataset.act;
    if (a === 'next') next();
    else if (a === 'back') { const steps = order(), i = steps.indexOf(W.step); if (i > 0) go(steps[i - 1]); else if (W.first) go('intro'); else close(); }
    else if (a === 'cancel') close();
    else if (a === 'skip') { state.settings.onboarded = true; await persist(); close(); render(true); }
    else if (a === 'kcal-' || a === 'kcal+') {
      W.kcal = Math.min(5000, Math.max(1000, W.kcal + (a === 'kcal+' ? 50 : -50)));
      const d = Math.round((W.kcal - W.est.tdee) / 10) * 10 || 0;
      $('#wz-kcal').textContent = W.kcal; $('#wz-delta').textContent = `${d > 0 ? '+' : ''}${d} kcal`; sfx.tap();
    }
  };
  draw();
}

function countUp(node, to, dur = 900) {
  if (!node) return;
  const t0 = performance.now();
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    node.textContent = Math.round(to * e);
    if (k < 1 && document.body.contains(node)) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ---------- Réglages ---------- */
function renderSettings() {
  const s = state.settings;
  view.innerHTML = `
    <h1>Réglages</h1>
    ${profileCardHTML()}
    <h2>Objectifs</h2>
    <div class="card stack">
      <div class="grid2">
        <label>Budget (kcal / jour)<input type="number" inputmode="numeric" id="s-kcal" value="${s.kcal}"></label>
        <label>Protéines visées (g)<input type="number" inputmode="numeric" id="s-prot" value="${s.prot}"></label>
      </div>
      <label>Bruitages
        <select id="s-sounds">
          <option value="on" ${s.sounds !== false ? 'selected' : ''}>Activés</option>
          <option value="off" ${s.sounds === false ? 'selected' : ''}>Désactivés</option>
        </select>
      </label>
      <label>Ton des messages
        <select id="s-tone">
          <option value="mix" ${(s.tone || 'mix') === 'mix' ? 'selected' : ''}>Mélangé</option>
          <option value="warm" ${s.tone === 'warm' ? 'selected' : ''}>Sobre et chaleureux</option>
          <option value="fun" ${s.tone === 'fun' ? 'selected' : ''}>Fun, avec des emojis</option>
        </select>
      </label>
      <label>Thème
        <select id="s-theme">
          <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Sombre</option>
          <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Clair</option>
          <option value="auto" ${s.theme === 'auto' ? 'selected' : ''}>Automatique (iPhone)</option>
        </select>
      </label>
    </div>
    <h2>Sauvegarde</h2>
    <div class="card stack">
      <p class="small muted" style="margin:0">Tes données sont uniquement sur cet iPhone. Exporte-les régulièrement : le fichier s'enregistre dans Fichiers / iCloud Drive.</p>
      <button class="btn primary block" data-action="export">Exporter mes données</button>
      <label class="btn block" style="flex-direction:row;justify-content:center;align-items:center;color:var(--text)">Importer un fichier<input type="file" id="import" accept="application/json,.json" hidden></label>
      <div class="small muted" id="backup-info"></div>
    </div>
    <h2>Synchronisation avec Claude</h2>
    <div class="card stack">
      <p class="small muted" style="margin:0">Envoie une copie de tes données dans un dépôt GitHub <b>privé</b> après chaque changement, pour que Claude puisse les consulter. Elle sert aussi de sauvegarde.</p>
      <label>Dépôt privé (compte/nom)<input type="text" id="sync-repo" placeholder="Saounaie/suivi-nutrition-data" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label>Jeton d'accès GitHub<input type="password" id="sync-token" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <button class="btn primary block" id="sync-save">Enregistrer et synchroniser</button>
      <div class="small" id="sync-info"></div>
      ${ls.get('syncCfg')?.token ? '<button class="btn danger block" id="sync-off">Désactiver et effacer le jeton</button>' : ''}
    </div>
    <h2>Application</h2>
    <div class="card stack">
      <div class="row between"><span>Version</span><b>${APP_VERSION}</b></div>
      <button class="btn block" id="update-now">Mettre à jour maintenant</button>
      <p class="small muted" style="margin:0">Cherche la dernière version sans toucher à tes données. <b>Ne supprime jamais l'icône de l'écran d'accueil</b> : ça efface toutes tes données et ta synchronisation.</p>
    </div>
    <h2>À propos</h2>
    <div class="card small muted">Valeurs nutritionnelles saisies à la main. Données Open Food Facts (licence ODbL) à venir à l'étape 3.</div>`;
  const save = () => {
    const k = parseNumber($('#s-kcal').value), p = parseNumber($('#s-prot').value);
    if (k > 0) state.settings.kcal = k;
    if (p > 0) state.settings.prot = p;
    state.settings.theme = $('#s-theme').value;
    state.settings.sounds = $('#s-sounds').value !== 'off';
    state.settings.tone = $('#s-tone').value;
    applyTheme(); persist(); sfx.tap();
  };
  ['#s-kcal', '#s-prot', '#s-theme', '#s-sounds', '#s-tone'].forEach((id) => $(id).addEventListener('change', save));
  $('#import').addEventListener('change', onImport);
  bindSyncSettings();
  $('#update-now').addEventListener('click', forceUpdate);
  const last = localStorage.getItem('lastExport');
  $('#backup-info').textContent = last ? `Dernier export : ${new Date(last).toLocaleDateString('fr-FR')}` : "Aucun export pour l'instant.";
}

function render(animate = false) {
  view.classList.remove('enter');
  if (animate) { void view.offsetWidth; view.classList.add('enter'); }
  document.querySelectorAll('#tabs button').forEach((b) => (b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  ({ today: renderToday, stock: renderStock, track: renderTrack, foods: renderFoods, settings: renderSettings })[tab]();
}

/* ---------- Feuilles (dialogues) ---------- */
let stopScan = null;
sheet.addEventListener('close', () => { if (stopScan) { stopScan(); stopScan = null; } });

function openSheet(html) { sheet.innerHTML = `<div class="sheet">${html}</div>`; if (!sheet.open) sheet.showModal(); }
function closeSheet() { if (sheet.open) sheet.close(); }

function sheetAdd(meal) {
  const prevCount = state.entries.filter((e) => e.date === shiftDate(date, -1) && e.meal === meal).length;
  openSheet(`
    <header><h3>Ajouter · ${MEALS.find((m) => m.id === meal).label}</h3><button class="icon-btn" data-action="close">Fermer</button></header>
    <button class="btn primary block" data-action="scan" data-mode="meal" data-meal="${meal}">Scanner un code-barres</button>
    <div class="grid2">
      <button class="btn" data-action="quick" data-meal="${meal}">Saisie rapide</button>
      <button class="btn" data-action="food-new-from-add" data-meal="${meal}">Nouvel aliment</button>
    </div>
    <div class="grid2">
      <button class="btn" data-action="saved-meals" data-meal="${meal}">⭐ Mes repas${(state.meals || []).length ? ` (${state.meals.length})` : ''}</button>
      <button class="btn" data-action="copy-prev" data-meal="${meal}" ${prevCount ? '' : 'disabled'}>Copier hier</button>
    </div>
    <label>Rechercher dans mes aliments<input type="search" id="add-q" placeholder="skyr, poulet…" autocomplete="off"></label>
    <div class="list" id="add-list"></div>`);
  const list = $('#add-list'), input = $('#add-q');
  const row = (f) => `
      <button type="button" class="item" data-action="pick" data-id="${esc(f.id)}" data-meal="${meal}">
        <span>${esc(f.name)}<br><span class="sub">${fmt(f.per100.kcal)} kcal · ${fmt(f.per100.prot)} g prot /100 g</span></span>
      </button>`;
  const draw = () => {
    const foods = searchFoods(state.foods, input.value);
    const freq = input.value.trim() ? [] : recentFoods(state.entries, state.foods, todayISO());
    const ids = new Set(freq.map((f) => f.id));
    const rest = foods.filter((f) => !ids.has(f.id));
    list.innerHTML = (freq.length ? `<div class="list-title">Fréquents</div>${freq.map(row).join('')}${rest.length ? '<div class="list-title">Tous les aliments</div>' : ''}` : '')
      + rest.map(row).join('') || '<div class="item"><span class="sub">Aucun résultat</span></div>';
  };
  input.addEventListener('input', draw); draw();
}

/* ---------- Repas enregistrés et copie ---------- */
const zoneOf = (foodId) => state.stock.filter((x) => x.foodId === foodId).sort((a, b) => ({ frigo: 0, placard: 1, congel: 2 })[a.zone] - ({ frigo: 0, placard: 1, congel: 2 })[b.zone])[0]?.zone || 'frigo';

/** Ajoute un aliment au journal à une date ; retire du stock ce qui est disponible. */
function addFoodEntry(food, grams, meal, on) {
  const zone = zoneOf(food.id);
  const deducted = stockOf(state.stock, food.id) > 0 ? deductStock(state.stock, food.id, grams).deducted : null;
  state.entries.push({ id: uid(), date: on, meal, foodId: food.id, label: food.name, grams, deducted, zone, ...macrosFor(food.per100, grams) });
}

function savedMealTotals(m) {
  return totals(m.items.map((i) => foodById(i.foodId)).map((f, k) => (f ? macrosFor(f.per100, m.items[k].grams) : emptyMacros())));
}

function sheetSaveMeal(mealId) {
  const items = state.entries.filter((e) => e.date === date && e.meal === mealId && e.foodId && e.grams > 0);
  const skipped = state.entries.filter((e) => e.date === date && e.meal === mealId).length - items.length;
  const label = MEALS.find((m) => m.id === mealId).label;
  openSheet(`
    <header><h3>Enregistrer ce repas</h3><button class="icon-btn" data-action="close">Fermer</button></header>
    <div class="muted small">${items.map((e) => `${esc(e.label)} ${fmt(e.grams)} g`).join(' · ')}</div>
    ${skipped ? `<div class="small warn">${skipped} saisie${skipped > 1 ? 's' : ''} rapide${skipped > 1 ? 's' : ''} non incluse${skipped > 1 ? 's' : ''} : seuls les aliments de ta liste sont enregistrés.</div>` : ''}
    <label>Nom du repas<input type="text" id="mn" value="${esc(label)}" autocomplete="off"></label>
    <div id="merr" class="small" style="color:var(--danger)"></div>
    <button class="btn primary block" id="msave">Enregistrer</button>`);
  $('#msave').addEventListener('click', async () => {
    const name = $('#mn').value.trim();
    if (!name) { $('#merr').textContent = 'Donne un nom à ce repas.'; return; }
    state.meals.push({ id: uid(), name: name.slice(0, 60), items: items.map((e) => ({ foodId: e.foodId, grams: e.grams })) });
    await persist(); closeSheet(); render(); toast('Repas enregistré ⭐');
  });
}

function sheetSavedMeals(meal) {
  const list = state.meals || [];
  openSheet(`
    <header><h3>Mes repas</h3><button class="icon-btn" data-action="add" data-meal="${meal}">Retour</button></header>
    ${list.length ? `<div class="list">${list.map((m) => { const t = savedMealTotals(m); return `
      <button type="button" class="item" data-action="saved-open" data-id="${esc(m.id)}" data-meal="${meal}">
        <span>${esc(m.name)}<br><span class="sub">${m.items.length} aliment${m.items.length > 1 ? 's' : ''} · ${t.kcal} kcal · ${fmt(t.prot)} g prot</span></span>
      </button>`; }).join('')}</div>`
      : '<div class="card muted">Aucun repas enregistré. Dans le Journal, touche ☆ à côté d\'un repas pour l\'enregistrer, puis ajoute-le en un geste.</div>'}`);
}

function sheetSavedMeal(id, meal) {
  const m = (state.meals || []).find((x) => x.id === id); if (!m) return;
  const t = savedMealTotals(m);
  openSheet(`
    <header><h3>${esc(m.name)}</h3><button class="icon-btn" data-action="saved-meals" data-meal="${meal}">Retour</button></header>
    <div class="list">${m.items.map((i) => { const f = foodById(i.foodId); return `<div class="item"><span>${f ? esc(f.name) : '<i>aliment supprimé</i>'}<br><span class="sub">${fmt(i.grams)} g</span></span></div>`; }).join('')}</div>
    <div class="muted">${t.kcal} kcal · ${fmt(t.prot)} g prot</div>
    <button class="btn primary block" id="madd">Ajouter à ${esc(MEALS.find((x) => x.id === meal).label.toLowerCase())}</button>
    <button class="btn danger block" id="mdel">Supprimer ce repas enregistré</button>`);
  $('#madd').addEventListener('click', async () => {
    let n = 0;
    for (const i of m.items) { const f = foodById(i.foodId); if (f) { addFoodEntry(f, i.grams, meal, date); n++; } }
    if (!n) { toast('Les aliments de ce repas ont été supprimés', 'error'); return; }
    markNew(); await persist(); closeSheet(); render(); toast('Repas ajouté');
  });
  $('#mdel').addEventListener('click', async () => {
    state.meals = state.meals.filter((x) => x.id !== id);
    await persist(); sheetSavedMeals(meal); toast('Repas supprimé', 'remove');
  });
}

async function copyPrevious(meal) {
  const src = state.entries.filter((e) => e.date === shiftDate(date, -1) && e.meal === meal);
  if (!src.length) return;
  for (const e of src) {
    const f = e.foodId ? foodById(e.foodId) : null;
    if (f && e.grams > 0) addFoodEntry(f, e.grams, meal, date);
    else state.entries.push({ ...e, id: uid(), date, deducted: null });
  }
  markNew(); await persist(); closeSheet(); render(); toast(`Repas d'hier copié (${src.length})`);
}

function sheetQuantity(foodId, meal) {
  const f = foodById(foodId);
  const portions = f.portions.length ? f.portions : [];
  const inStock = stockOf(state.stock, f.id);
  openSheet(`
    <header><h3>${esc(f.name)}</h3><button class="icon-btn" data-action="close">Fermer</button></header>
    ${f.per100.kcal == null ? '<div class="small warn">Les kcal de cet aliment ne sont pas renseignées : complète sa fiche pour un total juste.</div>' : ''}
    <div class="chips" id="portions">
      ${portions.map((p) => `<button type="button" class="chip" data-grams="${p.grams}">${esc(p.name)} · ${fmt(p.grams)} g</button>`).join('')}
    </div>
    <label>Quantité (g)<input type="text" inputmode="decimal" id="qty" value="${lastGrams(state.entries, f.id) ?? (portions[0] ? portions[0].grams : 100)}" autocomplete="off"></label>
    ${lastGrams(state.entries, f.id) != null ? '<div class="small muted" style="margin-top:-6px">Ta dernière quantité est pré-remplie.</div>' : ''}
    <div class="row between"><b id="preview"></b></div>
    ${inStock > 0 ? `<label style="flex-direction:row;align-items:center;gap:10px;color:var(--text);font-size:15px"><input type="checkbox" id="ded" checked style="width:22px;min-height:22px">Retirer du stock <span class="muted">(${fmt(inStock)} g disponibles)</span></label>` : ''}
    <button class="btn primary block" id="confirm">Ajouter</button>`);
  const qty = $('#qty'), prev = $('#preview');
  const upd = () => {
    const g = parseNumber(qty.value);
    if (!(g > 0)) { prev.textContent = 'Quantité invalide'; return null; }
    const m = macrosFor(f.per100, g);
    prev.textContent = `${m.kcal} kcal · ${fmt(m.prot)} g prot`;
    document.querySelectorAll('#portions .chip').forEach((c) => c.classList.toggle('on', Number(c.dataset.grams) === g));
    return { g, m };
  };
  qty.addEventListener('input', upd);
  $('#portions').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) { qty.value = c.dataset.grams; upd(); } });
  $('#confirm').addEventListener('click', async () => {
    const r = upd(); if (!r) return;
    let deducted = null, msg = 'Ajouté';
    if ($('#ded')?.checked) {
      const zone = state.stock.filter((x) => x.foodId === f.id).sort((a, b) => ({ frigo: 0, placard: 1, congel: 2 })[a.zone] - ({ frigo: 0, placard: 1, congel: 2 })[b.zone])[0]?.zone || 'frigo';
      const d = deductStock(state.stock, f.id, r.g);
      deducted = d.deducted;
      msg = d.short > 0 ? `Ajouté · stock insuffisant (il manquait ${fmt(d.short)} g)` : 'Ajouté · retiré du stock';
      state.entries.push({ id: uid(), date, meal, foodId: f.id, label: f.name, grams: r.g, deducted, zone, ...r.m });
    } else {
      state.entries.push({ id: uid(), date, meal, foodId: f.id, label: f.name, grams: r.g, deducted: null, zone: 'frigo', ...r.m });
    }
    markNew(); await persist(); closeSheet(); render(); toast(msg);
  });
  upd();
}

function sheetQuick(meal, entry) {
  openSheet(`
    <header><h3>${entry ? 'Modifier' : 'Saisie rapide'}</h3><button class="icon-btn" data-action="close">Fermer</button></header>
    <label>Description<input type="text" id="ql" value="${esc(entry?.label ?? '')}" placeholder="Cantine midi, restaurant…" autocomplete="off"></label>
    <div class="grid2">
      <label>Kcal<input type="text" inputmode="decimal" id="qk" value="${entry ? entry.kcal : ''}"></label>
      <label>Protéines (g)<input type="text" inputmode="decimal" id="qp" value="${entry ? String(entry.prot).replace('.', ',') : ''}"></label>
    </div>
    <div id="qerr" class="small" style="color:var(--danger)"></div>
    <button class="btn primary block" id="confirm">${entry ? 'Enregistrer' : 'Ajouter'}</button>`);
  $('#confirm').addEventListener('click', async () => {
    const k = parseNumber($('#qk').value), p = parseNumber($('#qp').value);
    if (!(k >= 0) || Number.isNaN(p)) { $('#qerr').textContent = 'Kcal obligatoires (nombre). Protéines : nombre ou vide.'; return; }
    const label = $('#ql').value.trim() || 'Repas';
    if (entry) Object.assign(entry, { label, kcal: k, prot: p ?? 0 });
    else state.entries.push({ id: uid(), date, meal, foodId: null, label, grams: null, kcal: k, prot: p ?? 0, carbs: 0, sugars: 0, fat: 0, fiber: 0 });
    if (!entry) markNew(); await persist(); closeSheet(); render(); toast(entry ? 'Modifié' : 'Ajouté');
  });
}

function sheetEntryMenu(id) {
  const e = state.entries.find((x) => x.id === id); if (!e) return;
  openSheet(`
    <header><h3>${esc(e.label)}</h3><button class="icon-btn" data-action="close">Fermer</button></header>
    <div class="muted">${e.grams ? fmt(e.grams) + ' g · ' : ''}${e.kcal} kcal · ${fmt(e.prot)} g prot</div>
    ${e.foodId && e.grams > 0 ? `
      <label>Quantité (g)<input type="text" inputmode="decimal" id="eg" value="${String(e.grams).replace('.', ',')}" autocomplete="off"></label>
      <div class="row between"><b id="epreview"></b></div>
      <div id="eerr" class="small" style="color:var(--danger)"></div>
      <button class="btn primary block" id="esave">Enregistrer la quantité</button>` : ''}
    <label>Déplacer vers
      <select id="mv">${MEALS.map((m) => `<option value="${m.id}" ${m.id === e.meal ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
    </label>
    ${e.foodId ? '' : '<button class="btn block" data-action="quick-edit" data-id="' + esc(e.id) + '">Modifier</button>'}
    <button class="btn danger block" id="del">Supprimer</button>`);
  if (e.foodId && e.grams > 0) {
    const food = foodById(e.foodId);
    const macrosAt = (g) => (food ? macrosFor(food.per100, g) : Object.fromEntries(MACROS.map((k) => [k, k === 'kcal' ? Math.round((e[k] * g) / e.grams) : Math.round(((e[k] * g) / e.grams) * 10) / 10])));
    const eg = $('#eg'), prev = $('#epreview');
    const upd = () => {
      const g = parseNumber(eg.value);
      if (!(g > 0)) { prev.textContent = 'Quantité invalide'; return null; }
      const m = macrosAt(g);
      prev.textContent = `${m.kcal} kcal · ${fmt(m.prot)} g prot`;
      return { g, m };
    };
    eg.addEventListener('input', upd); upd();
    $('#esave').addEventListener('click', async () => {
      const r = upd(); if (!r) { $('#eerr').textContent = 'Indique une quantité en grammes.'; return; }
      const diff = Math.round((r.g - e.grams) * 10) / 10;
      if (e.deducted > 0 && food) {
        if (diff < 0) {
          const back = Math.min(e.deducted, -diff);
          addStock(state.stock, { foodId: e.foodId, grams: back, zone: e.zone || 'frigo' });
          e.deducted = Math.round((e.deducted - back) * 10) / 10;
        } else if (diff > 0) {
          e.deducted = Math.round((e.deducted + deductStock(state.stock, e.foodId, diff).deducted) * 10) / 10;
        }
      }
      Object.assign(e, r.m, { grams: r.g });
      await persist(); closeSheet(); render(); toast('Quantité modifiée');
    });
  }
  $('#mv').addEventListener('change', async () => { e.meal = $('#mv').value; await persist(); closeSheet(); render(); });
  $('#del').addEventListener('click', async () => {
    const back = e.deducted > 0 && foodById(e.foodId);
    if (back) addStock(state.stock, { foodId: e.foodId, grams: e.deducted, zone: e.zone || 'frigo' });
    state.entries = state.entries.filter((x) => x.id !== id);
    await persist(); closeSheet(); render(); toast(back ? `Supprimé · ${fmt(e.deducted)} g remis en stock` : 'Supprimé', 'remove');
  });
}

function sheetFood(id, afterMeal, afterZone, prefill) {
  const f = id ? foodById(id) : { name: '', brand: '', barcode: '', per100: {}, portions: [], note: '', ...prefill };
  const v = (k) => (f.per100[k] == null ? '' : String(f.per100[k]).replace('.', ','));
  const fields = [['kcal', 'Kcal'], ['prot', 'Protéines (g)'], ['carbs', 'Glucides (g)'], ['sugars', 'dont sucres (g)'], ['fat', 'Lipides (g)'], ['fiber', 'Fibres (g)']];
  openSheet(`
    <header><h3>${id ? 'Fiche aliment' : 'Nouvel aliment'}</h3><button class="icon-btn" data-action="close">Fermer</button></header>
    ${f.source === 'off' && !id ? '<div class="alert" style="margin:0">Trouvé sur Open Food Facts : compare avec le paquet avant d\'enregistrer. Ces valeurs viennent d\'utilisateurs et peuvent être fausses.</div>' : ''}
    ${prefill && prefill.notFound ? `<div class="alert" style="margin:0">${esc(prefill.notFound)}</div>` : ''}
    <label>Nom<input type="text" id="fn" value="${esc(f.name)}" autocomplete="off"></label>
    <div class="grid2">
      <label>Marque<input type="text" id="fb" value="${esc(f.brand)}" autocomplete="off"></label>
      <label>Code-barres<input type="text" inputmode="numeric" id="fc" value="${esc(f.barcode)}" autocomplete="off"></label>
    </div>
    <h2 style="margin:4px 0 0">Pour 100 g</h2>
    <div class="grid2">${fields.map(([k, l]) => `<label>${l}<input type="text" inputmode="decimal" id="f-${k}" value="${v(k)}"></label>`).join('')}</div>
    <label>Portions (une par ligne : nom = grammes)<textarea id="fp" placeholder="1 pot = 150&#10;Ma dose = 200">${esc(f.portions.map((p) => `${p.name} = ${p.grams}`).join('\n'))}</textarea></label>
    <label>Note<input type="text" id="fnote" value="${esc(f.note)}" autocomplete="off"></label>
    <div id="ferr" class="small" style="color:var(--danger)"></div>
    <button class="btn primary block" id="save">Enregistrer</button>
    ${id ? '<button class="btn danger block" id="del">Supprimer cet aliment</button>' : ''}`);
  $('#save').addEventListener('click', async () => {
    const name = $('#fn').value.trim();
    if (!name) { $('#ferr').textContent = 'Le nom est obligatoire.'; return; }
    const per100 = {};
    for (const [k, l] of fields) {
      const n = parseNumber($(`#f-${k}`).value);
      if (Number.isNaN(n)) { $('#ferr').textContent = `${l} : nombre invalide.`; return; }
      per100[k] = n;
    }
    const portions = $('#fp').value.split('\n').map((l) => l.split('=')).filter((p) => p.length === 2)
      .map(([n, g]) => ({ name: n.trim(), grams: parseNumber(g) })).filter((p) => p.name && p.grams > 0);
    const barcode = $('#fc').value.replace(/\D/g, '');
    const dup = barcode && state.foods.find((x) => x.barcode === barcode && x.id !== id);
    if (dup) { $('#ferr').textContent = `Ce code-barres est déjà utilisé par « ${dup.name} ».`; return; }
    const data = { name, brand: $('#fb').value.trim(), barcode, per100, portions, note: $('#fnote').value.trim(), source: f.source === 'off' ? 'off' : 'manual' };
    let updated = 0, newId = null;
    if (id) { Object.assign(f, data); updated = reconcileEntries(state.entries, state.foods); } else { newId = uid(); state.foods.push({ id: newId, ...data }); }
    await persist(); closeSheet(); render(); toast(updated ? `Enregistré · ${updated} repas mis à jour` : 'Enregistré');
    if (afterMeal && newId) sheetQuantity(newId, afterMeal);
    if (afterZone && newId) sheetCourses(afterZone, newId);
  });
  const del = $('#del');
  if (del) del.addEventListener('click', async () => {
    if (!confirm(`Supprimer « ${f.name} » ? Les repas déjà notés restent dans le journal.`)) return;
    state.foods = state.foods.filter((x) => x.id !== id); await persist(); closeSheet(); render(); toast('Aliment supprimé', 'remove');
  });
}


/* ---------- Scan de code-barres ---------- */
function sheetScan(mode, meal, zone) {
  openSheet(`
    <header><h3>Scanner</h3><button class="icon-btn" data-action="close">Fermer</button></header>
    <video id="cam" playsinline muted style="width:100%;aspect-ratio:4/3;border-radius:14px;background:#000;object-fit:cover"></video>
    <div class="small muted" id="scan-msg">Place le code-barres au centre, à 15-20 cm.</div>
    <div class="row"><input type="text" inputmode="numeric" id="manual" placeholder="ou saisis le code" autocomplete="off"><button class="btn" id="manual-ok">OK</button></div>`);
  const msg = $('#scan-msg');
  const go = (code) => handleCode(code, mode, meal, zone);
  $('#manual-ok').addEventListener('click', () => { const c = normalizeBarcode($('#manual').value); if (c.length >= 8) go(c); else msg.textContent = 'Code trop court (8 à 13 chiffres).'; });
  startScanner($('#cam'), go).then((stop) => { stopScan = stop; }).catch((e) => { msg.textContent = e.message; });
}

async function handleCode(raw, mode, meal, zone) {
  const code = normalizeBarcode(raw);
  if (stopScan) { stopScan(); stopScan = null; }
  const local = findByBarcode(state.foods, code);
  const next = (food) => {
    if (mode === 'meal') sheetQuantity(food.id, meal);
    else if (mode === 'courses') sheetCourses(zone, food.id);
    else sheetFood(food.id);
  };
  if (local) { toast(`Déjà dans tes aliments : ${local.name}`, null); return next(local); }
  openSheet(`<header><h3>Recherche…</h3></header><div class="muted">Code ${esc(code)} · Open Food Facts</div>`);
  const r = await lookupBarcode(code);
  const ctxMeal = mode === 'meal' ? meal : null, ctxZone = mode === 'courses' ? zone : null;
  if (r.status === 'found') return sheetFood(null, ctxMeal, ctxZone, r.food);
  const why = r.status === 'error'
    ? "Open Food Facts n'a pas répondu (hors ligne ?). Tu peux saisir le produit à la main, il sera mémorisé avec son code-barres."
    : "Produit absent d'Open Food Facts. Saisis-le une fois : il sera mémorisé avec son code-barres.";
  sheetFood(null, ctxMeal, ctxZone, { barcode: code, notFound: why });
}

/* ---------- Export / import ---------- */
function onExport() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `suivi-nutrition-${todayISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  localStorage.setItem('lastExport', new Date().toISOString());
  toast('Export prêt : enregistre-le dans Fichiers');
}

async function onImport(ev) {
  const file = ev.target.files[0]; if (!file) return;
  try {
    const next = validateState(JSON.parse(await file.text()));
    if (!confirm(`Remplacer toutes tes données par ce fichier (${next.foods.length} aliments, ${next.entries.length} repas) ?`)) return;
    state = next; await persist(); applyTheme(); render(); toast('Import réussi');
  } catch (e) { toast('Import impossible : ' + e.message, 'error'); }
  ev.target.value = '';
}

/* ---------- Événements ---------- */
document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('#tabs button');
  if (tabBtn) { sfx.tap(); tab = tabBtn.dataset.tab; render(true); window.scrollTo(0, 0); return; }
  if (e.target.closest('.day, .chip')) sfx.tap();
  const el = e.target.closest('[data-action]'); if (!el) return;
  const a = el.dataset.action, id = el.dataset.id, meal = el.dataset.meal || mealOfHour(new Date().getHours());
  const actions = {
    goto: () => { date = el.dataset.date; render(true); },
    'today-btn': () => { date = todayISO(); render(true); },
    add: () => sheetAdd(meal),
    close: closeSheet,
    pick: () => sheetQuantity(id, meal),
    quick: () => sheetQuick(meal),
    'quick-edit': () => sheetQuick(null, state.entries.find((x) => x.id === id)),
    'entry-menu': () => sheetEntryMenu(id),
    'food-new': () => sheetFood(null),
    'food-new-from-add': () => sheetFood(null, meal),
    'food-edit': () => sheetFood(id),
    export: onExport,
    'body-del': async () => { if (!confirm('Supprimer cette mesure ?')) return; state.body = state.body.filter((b) => b.id !== id); await persist(); render(); toast('Mesure supprimée', 'remove'); },
    'idea-add': () => logIdea(Number(el.dataset.i)),
    goal: sheetGoal,
    trophy: () => sheetTrophy(id),
    wizard: () => openWizard(),
    'apply-estimate': async () => {
      const est = estimate(state.profile, latestWeight());
      state.settings.kcal = est.kcal; state.settings.prot = est.prot;
      await persist(); render(); toast('Budget mis à jour');
    },
    'save-meal': () => sheetSaveMeal(el.dataset.meal),
    'saved-meals': () => sheetSavedMeals(meal),
    'saved-open': () => sheetSavedMeal(id, meal),
    'copy-prev': () => copyPrevious(meal),
    'chart-range': () => { chartDays = Number(el.dataset.days); render(); },
    'trophies-toggle': () => { showAllTrophies = !showAllTrophies; render(); if (showAllTrophies) $('#trophies-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    'open-trophies': () => { tab = 'track'; showAllTrophies = false; render(true); window.scrollTo(0, 0); },
    'goto-settings': () => { tab = 'settings'; render(true); window.scrollTo(0, 0); },
    'nag-later': () => { ls.set('exportNagUntil', Date.now() + 3 * 864e5); render(); },
    'clean-seed': async () => {
      const del = seedCleanable();
      if (!del.length || !confirm(`Supprimer ${del.length} aliments d'exemple jamais utilisés ?`)) return;
      state.foods = state.foods.filter((f) => !del.includes(f));
      await persist(); render(); toast(`${del.length} aliments supprimés`, 'remove');
    },
    scan: () => sheetScan(el.dataset.mode, meal, el.dataset.zone || 'frigo'),
    'stock-edit': () => sheetStockItem(id),
    courses: () => sheetCourses(),
    'courses-pick': () => sheetCourses(el.dataset.zone, id),
    'courses-back': () => sheetCourses(el.dataset.zone),
    'food-new-courses': () => sheetFood(null, null, el.dataset.zone),
  };
  actions[a]?.();
});


/* ---------- Mises à jour (les données ne sont jamais touchées) ---------- */
async function forceUpdate() {
  toast('Recherche de la dernière version…', null);
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(regs.map((r) => r.unregister()));
    if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch (_) { /* on recharge quand même */ }
  location.reload();
}

function watchUpdates() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloadWanted = false;
  const reload = () => { if (sheet.open) reloadWanted = true; else location.reload(); };
  sheet.addEventListener('close', () => { if (reloadWanted) location.reload(); });
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) reload(); });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    reg.update().catch(() => {});
  }).catch(() => {});
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && ls.get('syncDirty')) doSync(); });

async function init() {
  state = await loadState();
  if (reconcileEntries(state.entries, state.foods)) await persist();
  applyTheme();
  markDayAnnounced();
  render(true);
  if (!state.settings.onboarded) openWizard({ first: true });
  setTimeout(checkProgress, 900);
  askPersistent();
  if (ls.get('syncDirty')) doSync();
  watchUpdates();
}
init();
