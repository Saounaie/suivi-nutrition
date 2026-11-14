// Profil de l'utilisateur et estimation du budget calorique. Logique pure : testable avec `node --test`.

export const GOALS = [
  { id: 'loss', label: 'Perdre du poids', desc: 'Un déficit modéré, durable et sans frustration.', icon: '📉' },
  { id: 'maintain', label: 'Maintenir mon poids', desc: 'Manger à ma faim en gardant mon poids actuel.', icon: '⚖️' },
  { id: 'gain', label: 'Prendre de la masse', desc: 'Un surplus contrôlé pour construire du muscle.', icon: '💪' },
];

export const ACTIVITY = [
  { id: 'sedentary', label: 'Sédentaire', desc: 'Travail assis, peu de marche', factor: 1.2, icon: '🛋️' },
  { id: 'light', label: 'Légèrement actif', desc: 'Marche régulière ou sport 1 à 2 fois par semaine', factor: 1.375, icon: '🚶' },
  { id: 'moderate', label: 'Actif', desc: 'Sport 3 à 4 fois par semaine', factor: 1.55, icon: '🏃' },
  { id: 'high', label: 'Très actif', desc: 'Sport 5 à 6 fois par semaine ou métier physique', factor: 1.725, icon: '🏋️' },
  { id: 'extreme', label: 'Athlète', desc: 'Entraînements quotidiens intenses', factor: 1.9, icon: '🔥' },
];

/** Rythme visé en kg par semaine. 1 kg de masse corporelle ≈ 7700 kcal. */
export const PACES = {
  loss: [
    { v: 0.25, label: 'Douce', desc: '0,25 kg par semaine' },
    { v: 0.5, label: 'Équilibrée', desc: '0,5 kg par semaine' },
    { v: 0.75, label: 'Soutenue', desc: '0,75 kg par semaine' },
  ],
  gain: [
    { v: 0.25, label: 'Progressive', desc: '0,25 kg par semaine' },
    { v: 0.5, label: 'Rapide', desc: '0,5 kg par semaine' },
  ],
};

const KCAL_PER_KG = 7700;
const FLOOR = { f: 1200, m: 1500 };

/** Âge en années entières à la date `today` (objet Date). */
export function ageOf(birthDate, today = new Date()) {
  const [y, m, d] = String(birthDate).split('-').map(Number);
  if (!y || !m || !d) return NaN;
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return age;
}

/** Métabolisme de base, formule de Mifflin-St Jeor (kcal par jour). */
export function bmr({ sex, weight, height, age }) {
  return 10 * weight + 6.25 * height - 5 * age + (sex === 'm' ? 5 : -161);
}

/** Renvoie un message d'erreur, ou null si le profil est complet et plausible. */
export function validateProfile(p, today = new Date()) {
  if (!p) return 'Profil manquant.';
  if (!['m', 'f'].includes(p.sex)) return 'Choisis une option pour le sexe : il sert au calcul du métabolisme.';
  const age = ageOf(p.birthDate, today);
  if (!(age >= 14 && age <= 100)) return 'Date de naissance invalide (entre 14 et 100 ans).';
  if (!(p.height >= 120 && p.height <= 230)) return 'Taille peu plausible (entre 120 et 230 cm).';
  if (!ACTIVITY.some((a) => a.id === p.activity)) return "Choisis ton niveau d'activité.";
  if (!GOALS.some((g) => g.id === p.goal)) return 'Choisis ton objectif.';
  if (p.goal !== 'maintain' && !PACES[p.goal].some((x) => x.v === p.pace)) return 'Choisis un rythme.';
  return null;
}

/** Nettoie un profil importé : renvoie un profil valide ou null. */
export function cleanProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const p = {
    sex: raw.sex === 'm' || raw.sex === 'f' ? raw.sex : null,
    birthDate: /^\d{4}-\d{2}-\d{2}$/.test(raw.birthDate) ? raw.birthDate : null,
    height: Number(raw.height) || null,
    activity: ACTIVITY.some((a) => a.id === raw.activity) ? raw.activity : null,
    goal: GOALS.some((g) => g.id === raw.goal) ? raw.goal : null,
    pace: Number(raw.pace) || null,
  };
  if (p.goal === 'maintain') p.pace = null;
  return validateProfile(p) ? null : p;
}

/**
 * Budget conseillé pour un profil et un poids (kg).
 * Le déficit est plafonné à 25 % de la dépense et le budget ne descend jamais sous 1200 kcal (femme) / 1500 kcal (homme).
 * Protéines : 2 g/kg en perte (préserve le muscle), 1,8 g/kg en prise, 1,6 g/kg en maintien.
 */
export function estimate(p, weight, today = new Date()) {
  const age = ageOf(p.birthDate, today);
  const base = bmr({ sex: p.sex, weight, height: p.height, age });
  const factor = ACTIVITY.find((a) => a.id === p.activity).factor;
  const tdee = base * factor;
  let delta = p.goal === 'maintain' ? 0 : (p.pace * KCAL_PER_KG) / 7;
  const notes = [];
  if (p.goal === 'loss') {
    if (delta > tdee * 0.25) { delta = tdee * 0.25; notes.push('Déficit limité à 25 % de ta dépense pour rester raisonnable.'); }
    delta = -delta;
  }
  let kcal = tdee + delta;
  if (kcal < FLOOR[p.sex]) { kcal = FLOOR[p.sex]; notes.push(`Budget remonté à ${FLOOR[p.sex]} kcal : en dessous, ce n'est pas recommandé sans suivi médical.`); }
  const perKg = p.goal === 'loss' ? 2 : p.goal === 'gain' ? 1.8 : 1.6;
  return {
    age, bmr: Math.round(base), tdee: Math.round(tdee),
    kcal: Math.round(kcal / 10) * 10,
    delta: Math.round((kcal - tdee) / 10) * 10 || 0,
    prot: Math.max(60, Math.round((perKg * weight) / 5) * 5),
    notes,
  };
}

/** Semaines estimées pour atteindre le poids cible au rythme choisi, ou null. */
export function weeksToGoal(p, weight, target) {
  if (p.goal === 'maintain' || !p.pace || target == null || !(Math.abs(weight - target) > 0)) return null;
  if ((p.goal === 'loss') !== (target < weight)) return null;
  return Math.max(1, Math.round(Math.abs(weight - target) / p.pace));
}
