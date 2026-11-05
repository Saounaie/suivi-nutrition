// Logique pure (sans DOM, sans stockage) : testable avec `node --test`.

export const MEALS = [
  { id: 'petit-dej', label: 'Petit-déjeuner' },
  { id: 'dejeuner', label: 'Déjeuner' },
  { id: 'diner', label: 'Dîner' },
  { id: 'collation', label: 'Collations' },
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
    ...Object.fromEntries(MACROS.map((k) => [k, num(e[k])])),
  }));
  const s = raw.settings || {};
  const settings = {
    kcal: num(s.kcal) || 1900,
    prot: num(s.prot) || 115,
    theme: ['dark', 'light', 'auto'].includes(s.theme) ? s.theme : 'dark',
  };
  return { v: 1, settings, foods, entries };
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
