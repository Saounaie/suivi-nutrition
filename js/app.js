import {
  MEALS, MACROS, macrosFor, totals, remaining, mealOfHour, parseNumber, todayISO, shiftDate,
  searchFoods, validateState, uid, dayStatus, weekOf,
} from './logic.js';
import { loadState, saveState, askPersistent } from './store.js';

let state;
let tab = 'today';
let date = todayISO();
let query = '';

const $ = (s) => document.querySelector(s);
const view = $('#view');
const sheet = $('#sheet');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null ? '?' : String(Math.round(n * 10) / 10).replace('.', ','));
const foodById = (id) => state.foods.find((f) => f.id === id);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('show'), 2500);
}

async function persist() {
  const ok = await saveState(state);
  if (!ok) toast("Enregistrement impossible : exporte tes données.");
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
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
  const meals = MEALS.map((m) => {
    const list = entries.filter((e) => e.meal === m.id);
    const mt = totals(list);
    return `
      <h2>${m.label} · ${mt.kcal} kcal · ${fmt(mt.prot)} g prot</h2>
      <div class="list">
        ${list.map((e) => `
          <button type="button" class="item" data-action="entry-menu" data-id="${esc(e.id)}">
            <span>${esc(e.label)}<br><span class="sub">${e.grams ? fmt(e.grams) + ' g · ' : ''}${e.kcal} kcal · ${fmt(e.prot)} g prot</span></span>
            <span class="muted">⋯</span>
          </button>`).join('') || '<div class="item"><span class="sub">Rien pour l\'instant</span></div>'}
        <button type="button" class="item" data-action="add" data-meal="${m.id}"><span class="warn" style="color:var(--accent)">+ Ajouter</span></button>
      </div>`;
  }).join('');
  const isPast = date < todayISO();
  const st = dayStatus(t.kcal, state.settings.kcal, isPast);
  const stText = { empty: '', ok: 'Dans ton budget', low: 'Un peu bas pour la journée', high: 'Légèrement au-dessus du budget', over: 'Nettement au-dessus du budget' }[st];
  const dayNames = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
  const week = weekOf(date).map((iso, i) => {
    const k = totals(state.entries.filter((e) => e.date === iso)).kcal;
    const s2 = dayStatus(k, state.settings.kcal, iso < todayISO());
    return `<button type="button" class="day s-${s2}" data-action="goto" data-date="${iso}" aria-pressed="${iso === date}" ${iso === todayISO() ? 'aria-current="date"' : ''} aria-label="${iso}">${dayNames[i]}<b>${Number(iso.slice(8))}</b><i></i></button>`;
  }).join('');
  const protPct = Math.min(100, Math.round((t.prot / state.settings.prot) * 100));
  view.innerHTML = `
    <div class="row between">
      <h1>Journal</h1>
      <button class="icon-btn" data-action="today-btn" ${date === todayISO() ? 'hidden' : ''}>Aujourd'hui</button>
    </div>
    <div class="muted small">${esc(dateLabel(date))}</div>
    <div class="week">${week}</div>
    <div class="card hero s-${st}" style="margin-top:16px">
      <div class="big">${Math.abs(left)} <span class="small muted" style="font-weight:500">kcal ${left >= 0 ? 'restantes' : 'au-dessus du budget'}</span></div>
      <div class="bar ${left < 0 ? 'over' : ''}"><i style="width:${pct}%"></i></div>
      <div class="small muted">${t.kcal} / ${state.settings.kcal} kcal</div>
      <div class="status">${stText}</div>
      <div class="macros">
        <div class="macro"><span class="small muted">Protéines</span><div class="bar prot"><i style="width:${protPct}%"></i></div><b>${fmt(t.prot)} g</b><span class="small muted">/ ${state.settings.prot} g</span></div>
        <div class="macro"><span class="small muted">Glucides</span><div class="bar carb"><i style="width:0"></i></div><b>${fmt(t.carbs)} g</b></div>
        <div class="macro"><span class="small muted">Lipides</span><div class="bar fat"><i style="width:0"></i></div><b>${fmt(t.fat)} g</b></div>
        <div class="macro"><span class="small muted">Fibres</span><div class="bar fib"><i style="width:0"></i></div><b>${fmt(t.fiber)} g</b></div>
      </div>
    </div>
    ${meals}
    <button class="fab" data-action="add" aria-label="Ajouter un aliment">+</button>`;
}

/* ---------- Écran Aliments ---------- */
function renderFoods() {
  const foods = searchFoods(state.foods, query);
  view.innerHTML = `
    <div class="row between"><h1>Aliments</h1><button class="btn primary" data-action="food-new">+ Nouveau</button></div>
    <label style="margin-top:14px">Rechercher<input type="search" id="q" value="${esc(query)}" placeholder="skyr, frites, code-barres…" autocomplete="off"></label>
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

/* ---------- Réglages ---------- */
function renderSettings() {
  const s = state.settings;
  view.innerHTML = `
    <h1>Réglages</h1>
    <h2>Objectifs</h2>
    <div class="card stack">
      <div class="grid2">
        <label>Budget (kcal / jour)<input type="number" inputmode="numeric" id="s-kcal" value="${s.kcal}"></label>
        <label>Protéines visées (g)<input type="number" inputmode="numeric" id="s-prot" value="${s.prot}"></label>
      </div>
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
      <label class="btn block" style="flex-direction:row;justify-content:center;color:var(--text)">Importer un fichier<input type="file" id="import" accept="application/json,.json" hidden></label>
      <div class="small muted" id="backup-info"></div>
    </div>
    <h2>À propos</h2>
    <div class="card small muted">Valeurs nutritionnelles saisies à la main. Données Open Food Facts (licence ODbL) à venir à l'étape 3.</div>`;
  const save = () => {
    const k = parseNumber($('#s-kcal').value), p = parseNumber($('#s-prot').value);
    if (k > 0) state.settings.kcal = k;
    if (p > 0) state.settings.prot = p;
    state.settings.theme = $('#s-theme').value;
    applyTheme(); persist();
  };
  ['#s-kcal', '#s-prot', '#s-theme'].forEach((id) => $(id).addEventListener('change', save));
  $('#import').addEventListener('change', onImport);
  const last = localStorage.getItem('lastExport');
  $('#backup-info').textContent = last ? `Dernier export : ${new Date(last).toLocaleDateString('fr-FR')}` : "Aucun export pour l'instant.";
}

function render() {
  document.querySelectorAll('#tabs button').forEach((b) => (b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  ({ today: renderToday, foods: renderFoods, settings: renderSettings })[tab]();
}

/* ---------- Feuilles (dialogues) ---------- */
function openSheet(html) { sheet.innerHTML = `<div class="sheet">${html}</div>`; if (!sheet.open) sheet.showModal(); }
function closeSheet() { if (sheet.open) sheet.close(); }

function sheetAdd(meal) {
  openSheet(`
    <header><h3>Ajouter · ${MEALS.find((m) => m.id === meal).label}</h3><button class="icon-btn" data-action="close">Fermer</button></header>
    <div class="grid2">
      <button class="btn" data-action="quick" data-meal="${meal}">Saisie rapide</button>
      <button class="btn" data-action="food-new-from-add" data-meal="${meal}">Nouvel aliment</button>
    </div>
    <label>Rechercher dans mes aliments<input type="search" id="add-q" placeholder="skyr, poulet…" autocomplete="off"></label>
    <div class="list" id="add-list"></div>`);
  const list = $('#add-list'), input = $('#add-q');
  const draw = () => {
    const foods = searchFoods(state.foods, input.value);
    list.innerHTML = foods.map((f) => `
      <button type="button" class="item" data-action="pick" data-id="${esc(f.id)}" data-meal="${meal}">
        <span>${esc(f.name)}<br><span class="sub">${fmt(f.per100.kcal)} kcal · ${fmt(f.per100.prot)} g prot /100 g</span></span>
      </button>`).join('') || '<div class="item"><span class="sub">Aucun résultat</span></div>';
  };
  input.addEventListener('input', draw); draw();
}

function sheetQuantity(foodId, meal) {
  const f = foodById(foodId);
  const portions = f.portions.length ? f.portions : [];
  openSheet(`
    <header><h3>${esc(f.name)}</h3><button class="icon-btn" data-action="close">Fermer</button></header>
    ${f.per100.kcal == null ? '<div class="small warn">Les kcal de cet aliment ne sont pas renseignées : complète sa fiche pour un total juste.</div>' : ''}
    <div class="chips" id="portions">
      ${portions.map((p) => `<button type="button" class="chip" data-grams="${p.grams}">${esc(p.name)} · ${fmt(p.grams)} g</button>`).join('')}
    </div>
    <label>Quantité (g)<input type="text" inputmode="decimal" id="qty" value="${portions[0] ? portions[0].grams : 100}" autocomplete="off"></label>
    <div class="row between"><b id="preview"></b></div>
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
    state.entries.push({ id: uid(), date, meal, foodId: f.id, label: f.name, grams: r.g, ...r.m });
    await persist(); closeSheet(); render(); toast('Ajouté');
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
    await persist(); closeSheet(); render(); toast(entry ? 'Modifié' : 'Ajouté');
  });
}

function sheetEntryMenu(id) {
  const e = state.entries.find((x) => x.id === id); if (!e) return;
  openSheet(`
    <header><h3>${esc(e.label)}</h3><button class="icon-btn" data-action="close">Fermer</button></header>
    <div class="muted">${e.grams ? fmt(e.grams) + ' g · ' : ''}${e.kcal} kcal · ${fmt(e.prot)} g prot</div>
    <label>Déplacer vers
      <select id="mv">${MEALS.map((m) => `<option value="${m.id}" ${m.id === e.meal ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
    </label>
    ${e.foodId ? '' : '<button class="btn block" data-action="quick-edit" data-id="' + esc(e.id) + '">Modifier</button>'}
    <button class="btn danger block" id="del">Supprimer</button>`);
  $('#mv').addEventListener('change', async () => { e.meal = $('#mv').value; await persist(); closeSheet(); render(); });
  $('#del').addEventListener('click', async () => { state.entries = state.entries.filter((x) => x.id !== id); await persist(); closeSheet(); render(); toast('Supprimé'); });
}

function sheetFood(id, afterMeal) {
  const f = id ? foodById(id) : { name: '', brand: '', barcode: '', per100: {}, portions: [], note: '' };
  const v = (k) => (f.per100[k] == null ? '' : String(f.per100[k]).replace('.', ','));
  const fields = [['kcal', 'Kcal'], ['prot', 'Protéines (g)'], ['carbs', 'Glucides (g)'], ['sugars', 'dont sucres (g)'], ['fat', 'Lipides (g)'], ['fiber', 'Fibres (g)']];
  openSheet(`
    <header><h3>${id ? 'Fiche aliment' : 'Nouvel aliment'}</h3><button class="icon-btn" data-action="close">Fermer</button></header>
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
    const data = { name, brand: $('#fb').value.trim(), barcode, per100, portions, note: $('#fnote').value.trim(), source: 'manual' };
    if (id) Object.assign(f, data); else state.foods.push({ id: uid(), ...data });
    await persist(); closeSheet(); render(); toast('Enregistré');
    if (afterMeal && !id) sheetAdd(afterMeal);
  });
  const del = $('#del');
  if (del) del.addEventListener('click', async () => {
    if (!confirm(`Supprimer « ${f.name} » ? Les repas déjà notés restent dans le journal.`)) return;
    state.foods = state.foods.filter((x) => x.id !== id); await persist(); closeSheet(); render();
  });
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
  } catch (e) { toast('Import impossible : ' + e.message); }
  ev.target.value = '';
}

/* ---------- Événements ---------- */
document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('#tabs button');
  if (tabBtn) { tab = tabBtn.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-action]'); if (!el) return;
  const a = el.dataset.action, id = el.dataset.id, meal = el.dataset.meal || mealOfHour(new Date().getHours());
  const actions = {
    goto: () => { date = el.dataset.date; render(); },
    'today-btn': () => { date = todayISO(); render(); },
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
  };
  actions[a]?.();
});

async function init() {
  state = await loadState();
  applyTheme();
  render();
  askPersistent();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const last = localStorage.getItem('lastExport');
  if (state.entries.length > 20 && (!last || Date.now() - new Date(last) > 14 * 864e5)) toast('Pense à exporter tes données (Réglages)');
}
init();
