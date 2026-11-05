// Logique pure (sans DOM, sans stockage) : testable avec `node --test`.

export const MEALS = [
  { id: 'petit-dej', label: 'Petit-déjeuner' },
  { id: 'dejeuner', label: 'Déjeuner' },
  { id: 'diner', label: 'Dîner' },
  { id: 'collation', label: 'Collations' },
];

export const ZONES = [
  { id: 'frigo', label: 'Frigo' },
  { id: 'congel', label: 'Congélateur' },
  { id: 'placard', label: 'Placard' },
];

export const MACROS = ['kcal', 'prot', 'carbs', 'sugars', 'fat', 'fiber'];

const round1 = (n) => Math.round(n * 10) / 10;

export function emptyMacros() {
  return { kcal: 0, prot: 0, carbs: 0, sugars: 0, fat: 0, fiber: 0 };
}

/** Macros d'une quantité (g) d'un aliment dont les valeurs sont pour 100 g. Une valeur absente (null) compte 0. */
export function macrosFor(per100, grams) {
  const out = emptyMacros();
  for (const k of MACROS) out[k] = round1(((Number(per100?.[k]) || 0) * grams) / 100);
  out.kcal = Math.round(out.kcal);
  return out;
}

export function totals(entries) {
  const t = emptyMacros();
  for (const e of entries) for (const k of MACROS) t[k] += Number(e[k]) || 0;
  for (const k of MACROS) t[k] = k === 'kcal' ? Math.round(t[k]) : round1(t[k]);
  return t;
}

export function remaining(budgetKcal, entries) {
  return Math.round(budgetKcal - totals(entries).kcal);
}

export function mealOfHour(hour) {
  if (hour < 10) return 'petit-dej';
  if (hour < 15) return 'dejeuner';
  if (hour < 18) return 'collation';
  return 'diner';
}

/** "3,9" ou "3.9" -> 3.9 ; vide -> null ; invalide -> NaN */
export function parseNumber(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(',', '.');
  if (t === '') return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

export function todayISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return todayISO(new Date(y, m - 1, d + days));
}

export function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function searchFoods(foods, query) {
  const q = normalize(query).trim();
  if (!q) return [...foods].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return foods
    .filter((f) => normalize(`${f.name} ${f.brand || ''} ${f.barcode || ''}`).includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** Valide et nettoie un état importé. Lance une Error si le fichier n'est pas utilisable. */
export function validateState(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1) throw new Error("Fichier non reconnu (version attendue : 1).");
  if (!Array.isArray(raw.foods) || !Array.isArray(raw.entries)) throw new Error('Fichier incomplet.');
  const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  const optNum = (x) => (x == null || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);
  const str = (x, max = 200) => String(x ?? '').slice(0, max);
  const foods = raw.foods.map((f) => ({
    id: str(f.id, 60),
    name: str(f.name),
    brand: str(f.brand),
    barcode: str(f.barcode, 20),
    per100: Object.fromEntries(MACROS.map((k) => [k, optNum(f.per100?.[k])])),
    portions: (Array.isArray(f.portions) ? f.portions : []).map((p) => ({ name: str(p.name, 60), grams: num(p.grams) })).filter((p) => p.grams > 0),
    source: f.source === 'off' ? 'off' : 'manual',
    note: str(f.note, 300),
  }));
  const entries = raw.entries.map((e) => ({
    id: str(e.id, 60),
    date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : todayISO(),
    meal: MEALS.some((m) => m.id === e.meal) ? e.meal : 'collation',
    foodId: e.foodId ? str(e.foodId, 60) : null,
    label: str(e.label),
    grams: optNum(e.grams),
    deducted: optNum(e.deducted),
    zone: ZONES.some((z) => z.id === e.zone) ? e.zone : 'frigo',
    ...Object.fromEntries(MACROS.map((k) => [k, num(e[k])])),
  }));
  const foodIds = new Set(foods.map((f) => f.id));
  const stock = (Array.isArray(raw.stock) ? raw.stock : [])
    .map((x) => ({
      id: str(x.id, 60), foodId: str(x.foodId, 60), grams: Math.max(0, num(x.grams)),
      zone: ZONES.some((z) => z.id === x.zone) ? x.zone : 'frigo',
      dlc: /^\d{4}-\d{2}-\d{2}$/.test(x.dlc) ? x.dlc : null,
    }))
    .filter((x) => foodIds.has(x.foodId) && x.grams > 0);
  const s = raw.settings || {};
  const settings = {
    kcal: num(s.kcal) || 1900,
    prot: num(s.prot) || 115,
    theme: ['dark', 'light', 'auto'].includes(s.theme) ? s.theme : 'dark',
  };
  return { v: 1, settings, foods, entries, stock };
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Statut d'une journée : 'empty' | 'ok' | 'low' (trop bas, jour passé) | 'high' (au-dessus) | 'over' (>10 % au-dessus). */
export function dayStatus(kcal, budget, isPast) {
  if (!(kcal > 0)) return 'empty';
  if (kcal > budget * 1.1) return 'over';
  if (kcal > budget) return 'high';
  if (isPast && kcal < budget * 0.75) return 'low';
  return 'ok';
}

/** Les 7 jours (lundi -> dimanche) de la semaine contenant `iso`. */
export function weekOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => shiftDate(iso, i - dow));
}

/** Recalcule les repas liés à un aliment (foodId + quantité) d'après ses valeurs actuelles. Les saisies rapides et les aliments supprimés gardent leurs valeurs. Renvoie le nombre de repas modifiés. */
export function reconcileEntries(entries, foods) {
  const byId = new Map(foods.map((f) => [f.id, f]));
  let changed = 0;
  for (const e of entries) {
    const f = e.foodId ? byId.get(e.foodId) : null;
    if (!f || !(e.grams > 0)) continue;
    const m = macrosFor(f.per100, e.grams);
    let diff = false;
    for (const k of MACROS) if (e[k] !== m[k]) { e[k] = m[k]; diff = true; }
    if (e.label !== f.name) { e.label = f.name; diff = true; }
    if (diff) changed++;
  }
  return changed;
}

/* ---------- Stock (frigo) ---------- */
const ZONE_RANK = { frigo: 0, placard: 1, congel: 2 };

/** Ajoute du stock (g). Fusionne avec la ligne existante du même aliment et de la même zone ; garde la DLC la plus proche. */
export function addStock(stock, { foodId, grams, zone = 'frigo', dlc = null }) {
  const ex = stock.find((x) => x.foodId === foodId && x.zone === zone);
  if (ex) {
    ex.grams = round1(ex.grams + grams);
    if (dlc && (!ex.dlc || dlc < ex.dlc)) ex.dlc = dlc;
    return ex;
  }
  const item = { id: uid(), foodId, grams: round1(grams), zone, dlc: dlc || null };
  stock.push(item);
  return item;
}

export function stockOf(stock, foodId) {
  return round1(stock.filter((x) => x.foodId === foodId).reduce((a, x) => a + x.grams, 0));
}

/** Retire `grams` du stock d'un aliment : frigo puis placard puis congélateur, DLC la plus proche d'abord. Supprime les lignes vides. Renvoie { deducted, short }. */
export function deductStock(stock, foodId, grams) {
  let left = grams;
  const items = stock
    .filter((x) => x.foodId === foodId)
    .sort((a, b) => ZONE_RANK[a.zone] - ZONE_RANK[b.zone] || (a.dlc || '9999').localeCompare(b.dlc || '9999'));
  for (const it of items) {
    if (left <= 0) break;
    const take = Math.min(it.grams, left);
    it.grams = round1(it.grams - take);
    left = round1(left - take);
  }
  for (let i = stock.length - 1; i >= 0; i--) if (stock[i].grams <= 0) stock.splice(i, 1);
  return { deducted: round1(grams - left), short: left };
}

/** Jours restants avant la DLC (négatif si dépassée), null sans DLC. */
export function daysLeft(dlc, today) {
  if (!dlc) return null;
  const t = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(dlc) - t(today)) / 864e5);
}
