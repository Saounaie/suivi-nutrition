// Motivation : séries, trophées, niveaux, messages d'encouragement. Logique pure : testable avec `node --test`.
import { totals, dayStatus, shiftDate, weekOf, movingAverage, daysLeft } from './logic.js';

const round1 = (n) => Math.round(n * 10) / 10;
const weekKey = (iso) => weekOf(iso)[0];

/* ---------- Séries ---------- */

/** Série de jours réussis entre `from` et `to`, avec un joker par semaine : un jour raté ne casse la série que si le joker de sa semaine (lundi -> dimanche) est déjà pris. `today` sert à savoir si le joker de la semaine en cours est encore libre. */
export function streaks(isGood, from, to, today = to) {
  let current = 0, best = 0;
  const jokers = new Set();
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    if (isGood(d)) { current++; best = Math.max(best, current); continue; }
    const w = weekKey(d);
    if (current > 0 && !jokers.has(w)) jokers.add(w);
    else current = 0;
  }
  return { current, best, jokerLeft: !jokers.has(weekKey(today)) };
}

/** Tout ce dont les trophées, les séries et les messages ont besoin, calculé depuis l'état. */
export function computeStats(state, today) {
  const { entries, body, foods, settings } = state;
  const lists = new Map();
  for (const e of entries) { if (!lists.has(e.date)) lists.set(e.date, []); lists.get(e.date).push(e); }
  const day = new Map([...lists].map(([d, l]) => [d, totals(l)]));
  const dates = [...day.keys()].sort();
  const first = dates[0] || null;
  const yesterday = shiftDate(today, -1);
  const noStreak = { current: 0, best: 0, jokerLeft: true };

  const logTo = day.has(today) ? today : yesterday;
  const log = first && first <= logTo ? streaks((d) => day.has(d), first, logTo, today) : noStreak;
  const isOk = (d) => dayStatus(day.get(d)?.kcal || 0, settings.kcal, true) === 'ok';
  const budget = first && first <= yesterday ? streaks(isOk, first, yesterday, today) : noStreak;

  const finished = dates.filter((d) => d < today);
  const perWeek = (list) => {
    const m = new Map();
    for (const d of list) m.set(weekKey(d), (m.get(weekKey(d)) || 0) + 1);
    return Math.max(0, ...m.values());
  };
  const okDays = finished.filter(isOk);
  const protDays = dates.filter((d) => day.get(d).prot >= settings.prot);
  const last = [...dates].reverse().find((d) => d < today) || null;

  const weights = body.filter((b) => b.weight != null).map((b) => ({ date: b.date, value: b.weight })).sort((a, b) => a.date.localeCompare(b.date));
  const startWeight = settings.goalStart ?? weights[0]?.value ?? null;
  const avg = movingAverage(weights, 7);
  const curAvg = avg.length ? avg[avg.length - 1].value : null;
  const bestAvg = avg.length ? Math.min(...avg.map((p) => p.value)) : null;
  const lost = startWeight != null && bestAvg != null ? Math.max(0, round1(startWeight - bestAvg)) : 0;
  const waists = body.filter((b) => b.waist != null).sort((a, b) => a.date.localeCompare(b.date)).map((b) => b.waist);
  const waistLost = waists.length ? Math.max(0, round1(waists[0] - Math.min(...waists))) : 0;

  const goal = settings.goalWeight;
  const total = goal != null && startWeight != null ? startWeight - goal : 0;
  const frac = (w) => (total > 0 && w != null ? Math.min(1, Math.max(0, (startWeight - w) / total)) : 0);

  return {
    meals: entries.length, days: dates.length, log, budget, daysAway: last && !day.has(today) ? daysLeft(today, last) : null,
    okDays: okDays.length, solidWeek: perWeek(okDays), protDays: protDays.length, protWeek: perWeek(protDays),
    fiberMax: dates.length ? Math.max(...dates.map((d) => day.get(d).fiber)) : 0,
    weighIns: weights.length, waistCount: waists.length, weighWeeks: new Set(weights.map((w) => weekKey(w.date))).size,
    startWeight, curAvg, lost, waistLost, goal: total > 0 ? goal : null, goalFrac: frac(curAvg), goalFracBest: frac(bestAvg),
    foodsScanned: foods.filter((f) => f.barcode).length, foodCount: foods.length, mealsFromStock: entries.filter((e) => e.deducted > 0).length,
  };
}

/* ---------- Trophées ---------- */

export const TROPHY_GROUPS = [
  { id: 'reg', label: 'Régularité' },
  { id: 'nut', label: 'Nutrition' },
  { id: 'body', label: 'Corps' },
  { id: 'fridge', label: 'Frigo' },
];

const T = (id, group, icon, name, desc, value, target, unit = '') => ({ id, group, icon, name, desc, value, target, unit });

export const TROPHIES = [
  T('first-meal', 'reg', '🍽️', 'Premier pas', 'Note ton premier repas.', (s) => s.meals, 1),
  T('log3', 'reg', '🔥', 'Sur la lancée', 'Suis ton alimentation 3 jours d\'affilée.', (s) => s.log.best, 3, 'j'),
  T('log7', 'reg', '📅', 'Semaine complète', 'Suis ton alimentation 7 jours d\'affilée.', (s) => s.log.best, 7, 'j'),
  T('log14', 'reg', '⚡', 'Deux semaines', 'Suis ton alimentation 14 jours d\'affilée.', (s) => s.log.best, 14, 'j'),
  T('log30', 'reg', '🏅', 'Un mois d\'assiduité', 'Suis ton alimentation 30 jours d\'affilée.', (s) => s.log.best, 30, 'j'),
  T('meals100', 'reg', '💯', 'Centurion', 'Note 100 repas.', (s) => s.meals, 100),

  T('ok1', 'nut', '🎯', 'Dans le mille', 'Termine une journée dans ton budget.', (s) => s.okDays, 1),
  T('ok3', 'nut', '🌱', 'Ça prend forme', 'Reste dans ton budget 3 jours d\'affilée.', (s) => s.budget.best, 3, 'j'),
  T('ok7', 'nut', '🏆', 'Semaine maîtrisée', 'Reste dans ton budget 7 jours d\'affilée.', (s) => s.budget.best, 7, 'j'),
  T('solid-week', 'nut', '🛡️', 'Semaine solide', 'Sois dans ton budget 5 jours sur une même semaine (lundi → dimanche).', (s) => s.solidWeek, 5, 'j'),
  T('prot1', 'nut', '💪', 'Plein de protéines', 'Atteins ton objectif de protéines sur une journée.', (s) => s.protDays, 1),
  T('prot5', 'nut', '🥩', 'Cap protéines', 'Atteins ton objectif de protéines 5 jours sur une même semaine.', (s) => s.protWeek, 5, 'j'),
  T('fiber', 'nut', '🥦', 'Fibres au rendez-vous', 'Atteins 30 g de fibres sur une journée.', (s) => s.fiberMax, 30, 'g'),

  T('weigh1', 'body', '⚖️', 'Première pesée', 'Enregistre ton poids.', (s) => s.weighIns, 1),
  T('waist1', 'body', '📏', 'Ruban en main', 'Enregistre ton tour de taille.', (s) => s.waistCount, 1),
  T('weigh4', 'body', '📈', 'Pesées régulières', 'Pèse-toi pendant 4 semaines différentes.', (s) => s.weighWeeks, 4, 'sem.'),
  T('lose1', 'body', '🌟', 'Premier kilo', 'Perds 1 kg (moyenne sur 7 jours).', (s) => s.lost, 1, 'kg'),
  T('lose2', 'body', '⭐', 'Deux kilos', 'Perds 2 kg (moyenne sur 7 jours).', (s) => s.lost, 2, 'kg'),
  T('lose5', 'body', '🚀', 'Cinq kilos', 'Perds 5 kg (moyenne sur 7 jours).', (s) => s.lost, 5, 'kg'),
  T('waist2', 'body', '🧵', 'Deux cm de moins', 'Perds 2 cm de tour de taille.', (s) => s.waistLost, 2, 'cm'),
  T('waist5', 'body', '👖', 'Pantalon plus large', 'Perds 5 cm de tour de taille.', (s) => s.waistLost, 5, 'cm'),
  T('goal-half', 'body', '🧭', 'Mi-chemin', 'Fais la moitié du chemin vers ton objectif de poids.', (s) => Math.round(s.goalFracBest * 100), 50, '%'),
  T('goal-done', 'body', '👑', 'Objectif atteint', 'Atteins ton poids cible.', (s) => Math.round(s.goalFracBest * 100), 100, '%'),

  T('scan1', 'fridge', '📷', 'Chasseur de codes-barres', 'Ajoute un produit avec son code-barres.', (s) => s.foodsScanned, 1),
  T('foods10', 'fridge', '📚', 'Bibliothèque bien garnie', 'Aie 10 aliments dans ta liste.', (s) => s.foodCount, 10),
  T('stock10', 'fridge', '🧊', 'Frigo bien utilisé', 'Note 10 repas retirés de ton stock.', (s) => s.mealsFromStock, 10),
];

/** Avancement d'un trophée : valeur plafonnée à la cible. */
export function trophyProgress(t, stats) {
  const v = t.value(stats);
  return { value: Math.min(v, t.target), target: t.target, done: v >= t.target };
}

export function unlockedTrophies(stats) {
  return TROPHIES.filter((t) => trophyProgress(t, stats).done).map((t) => t.id);
}

export const LEVELS = [
  { min: 0, name: 'Débutant' }, { min: 2, name: 'Lancé' }, { min: 5, name: 'Régulier' }, { min: 9, name: 'Motivé' },
  { min: 13, name: 'Assidu' }, { min: 18, name: 'Confirmé' }, { min: 22, name: 'Expert' }, { min: TROPHIES.length, name: 'Légende' },
];

/** Niveau selon le nombre de trophées débloqués, avec la progression vers le suivant. */
export function levelOf(count) {
  let i = 0;
  while (i + 1 < LEVELS.length && count >= LEVELS[i + 1].min) i++;
  const cur = LEVELS[i], next = LEVELS[i + 1] || null;
  return { name: cur.name, rank: i + 1, next: next ? { name: next.name, need: next.min - count } : null, pct: next ? (count - cur.min) / (next.min - cur.min) : 1 };
}

/* ---------- Messages d'encouragement ---------- */

// t : 'warm' (sobre et chaleureux) ou 'fun' (emojis, humour). Pas de formes genrées : on ne sait pas comment s'adresser à la personne.
export const MESSAGES = {
  morning: [
    { t: 'warm', x: 'Bonne journée à toi. Un petit-déjeuner solide, et tu pars du bon pied.' },
    { t: 'fun', x: 'Debout ! ☀️ Ton budget est tout frais, à toi de l\'étrenner.' },
    { t: 'warm', x: 'Chaque repas noté est un pas de plus vers ton objectif.' },
    { t: 'fun', x: 'Le café est prêt ? ☕ Note ce petit-déj et c\'est parti !' },
  ],
  empty: [
    { t: 'warm', x: 'Rien de noté pour l\'instant. Pas de souci, il n\'est jamais trop tard pour s\'y mettre.' },
    { t: 'fun', x: 'Ton journal a faim lui aussi 🍽️ Ajoute ton premier aliment !' },
    { t: 'warm', x: 'Note ton repas dès que tu peux : ça prend dix secondes.' },
    { t: 'fun', x: 'Mission du moment : remplir ce journal. Tu gères 💪' },
  ],
  'evening-empty': [
    { t: 'warm', x: 'Il reste le dîner pour compléter ta journée. Noter, même tard, ça compte.' },
    { t: 'fun', x: 'Le journal est tout blanc 🙈 Un petit rattrapage avant la nuit ?' },
    { t: 'warm', x: 'Même une journée incomplète t\'apprend quelque chose. Note ce que tu peux.' },
    { t: 'fun', x: 'Dernière ligne droite 🏁 Ajoute ce que tu as mangé aujourd\'hui.' },
  ],
  back: [
    { t: 'warm', x: 'Ça fait plaisir de te revoir ! {n} jours sans noter, ce n\'est pas grave : on repart d\'ici.' },
    { t: 'fun', x: 'Te revoilà ! 🎉 {n} jours d\'absence, on fait comme si de rien n\'était.' },
    { t: 'warm', x: 'L\'important n\'est pas la pause, c\'est la reprise. Bravo d\'être là.' },
    { t: 'fun', x: 'Le grand retour ! 🥁 Ton journal t\'attendait.' },
  ],
  over: [
    { t: 'warm', x: 'Un peu au-dessus aujourd\'hui, ce n\'est pas grave. Ce qui compte, c\'est la semaine, pas un seul jour.' },
    { t: 'fun', x: 'Petit écart du jour 🍕 Demain, on rééquilibre sans stress.' },
    { t: 'warm', x: 'Une journée ne défait pas tes progrès. Reprends tranquillement demain.' },
    { t: 'fun', x: 'Ça arrive aux meilleurs 😄 Une bonne marche et on n\'en parle plus.' },
  ],
  perfect: [
    { t: 'warm', x: 'Budget respecté et protéines atteintes : une journée très réussie.' },
    { t: 'fun', x: 'Budget ✅ Protéines ✅ Tu es en feu 🔥' },
    { t: 'warm', x: 'Voilà une journée équilibrée. Tu as de quoi te féliciter.' },
    { t: 'fun', x: 'Journée parfaite 🏆 On encadre celle-là !' },
  ],
  almost: [
    { t: 'warm', x: 'Plus que {left} kcal : tu finis la journée en douceur dans ton budget.' },
    { t: 'fun', x: 'Il reste {left} kcal, de quoi une petite douceur 🍫 mais sans abuser !' },
    { t: 'warm', x: 'Tu approches de ton budget avec régularité. Termine tranquillement.' },
    { t: 'fun', x: 'Atterrissage en vue 🛬 {left} kcal restantes.' },
  ],
  protClose: [
    { t: 'warm', x: 'Il te manque {protLeft} g de protéines : un skyr ou un œuf et c\'est bon.' },
    { t: 'fun', x: 'Presque ! 💪 Encore {protLeft} g de protéines pour décrocher la mention.' },
    { t: 'warm', x: 'Tes protéines sont presque au rendez-vous, continue comme ça.' },
    { t: 'fun', x: 'Les muscles applaudissent 👏 Plus que {protLeft} g de protéines.' },
  ],
  streak: [
    { t: 'warm', x: '{n} jours de suivi d\'affilée. Cette régularité est ta meilleure alliée.' },
    { t: 'fun', x: '{n} jours d\'affilée 🔥 La flamme ne s\'éteint pas !' },
    { t: 'warm', x: 'Tu tiens ton rythme depuis {n} jours : c\'est ça qui fait la différence.' },
    { t: 'fun', x: 'Série de {n} jours ! 🚀 Ne la lâche pas.' },
  ],
  going: [
    { t: 'warm', x: 'Tu avances bien. Continue de noter chaque repas.' },
    { t: 'fun', x: 'Ça se passe bien par ici 😎 Continue comme ça !' },
    { t: 'warm', x: 'Chaque repas noté te rapproche de ton objectif.' },
    { t: 'fun', x: 'Un repas après l\'autre, tu construis ta victoire 🧱' },
  ],
  protGoal: [
    { t: 'warm', x: 'Objectif protéines atteint, bien joué.' },
    { t: 'fun', x: 'Protéines au max 💪' },
  ],
  weekGreat: [
    { t: 'warm', x: 'Excellente semaine : tu as tenu ton budget presque tous les jours.' },
    { t: 'fun', x: 'Semaine de champion 🏆 Presque sans faute !' },
  ],
  weekGood: [
    { t: 'warm', x: 'Belle régularité cette semaine. Elle finira par payer.' },
    { t: 'fun', x: 'Une semaine bien remplie côté journal 📒 Bravo pour la constance !' },
  ],
  weekStart: [
    { t: 'warm', x: 'Chaque semaine est une occasion de s\'améliorer. Celle-ci est un bon départ.' },
    { t: 'fun', x: 'On se chauffe 🔥 La semaine prochaine, on vise plus de jours notés !' },
  ],
  weekEmpty: [
    { t: 'warm', x: 'Aucun repas noté sur 7 jours. Reprends quand tu veux, l\'appli t\'attend.' },
    { t: 'fun', x: 'Semaine blanche 🌫️ Un repas noté aujourd\'hui et on repart !' },
  ],
  goalStart: [
    { t: 'warm', x: 'Le plus dur, c\'est de commencer, et c\'est fait. Il reste {left} kg, étape par étape.' },
    { t: 'fun', x: '{left} kg à aller chercher 🎯 Un petit pas après l\'autre !' },
  ],
  goalMid: [
    { t: 'warm', x: 'Tu es en bonne voie : plus que {left} kg.' },
    { t: 'fun', x: 'Tu avances ! 🚶 Encore {left} kg avant la ligne d\'arrivée.' },
  ],
  goalNear: [
    { t: 'warm', x: 'La fin approche : {left} kg et c\'est gagné.' },
    { t: 'fun', x: 'Ligne droite 🏁 Plus que {left} kg !' },
  ],
  goalDone: [
    { t: 'warm', x: 'Objectif atteint. Quel beau parcours, félicitations !' },
    { t: 'fun', x: 'OBJECTIF ATTEINT 🎉👑 Quelle performance !' },
  ],
};

/** Hash stable d'une chaîne : le message choisi ne change pas à chaque affichage de la journée. */
export const seedOf = (str) => [...String(str)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Choisit un message de la catégorie `key` selon le ton ('mix' | 'warm' | 'fun') et remplace les {variables}. */
export function pickMessage(key, seed, tone = 'mix', vars = {}) {
  const all = MESSAGES[key] || [];
  const list = tone === 'mix' ? all : all.filter((m) => m.t === tone);
  const pool = list.length ? list : all;
  if (!pool.length) return '';
  return pool[seed % pool.length].x.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

/** Quelle catégorie de message pour la journée en cours. */
export function situation({ hour, count, kcal, budget, prot, protGoal, streak, daysAway }) {
  if (count === 0) {
    if (daysAway != null && daysAway >= 3) return { key: 'back', vars: { n: daysAway } };
    if (hour < 11) return { key: 'morning', vars: {} };
    if (hour >= 18) return { key: 'evening-empty', vars: {} };
    return { key: 'empty', vars: {} };
  }
  if (kcal > budget) return { key: 'over', vars: {} };
  if (prot >= protGoal) return { key: 'perfect', vars: {} };
  const left = Math.round(budget - kcal);
  if (left <= 150) return { key: 'almost', vars: { left } };
  if (prot >= 0.75 * protGoal) return { key: 'protClose', vars: { protLeft: Math.max(1, Math.round(protGoal - prot)) } };
  if (streak >= 3) return { key: 'streak', vars: { n: streak } };
  return { key: 'going', vars: {} };
}

/** Bilan des 7 derniers jours (aujourd'hui inclus). */
export function weekRecap(state, today) {
  const { entries, settings, body } = state;
  let days = 0, ok = 0, protDays = 0;
  for (let i = 0; i < 7; i++) {
    const d = shiftDate(today, -i);
    const list = entries.filter((e) => e.date === d);
    if (!list.length) continue;
    const t = totals(list);
    days++;
    if (dayStatus(t.kcal, settings.kcal, d < today) === 'ok') ok++;
    if (t.prot >= settings.prot) protDays++;
  }
  const pts = body.filter((b) => b.weight != null).map((b) => ({ date: b.date, value: b.weight })).sort((a, b) => a.date.localeCompare(b.date));
  const avg = movingAverage(pts, 7);
  const last = avg[avg.length - 1];
  const ref = last ? [...avg].reverse().find((p) => p.date <= shiftDate(last.date, -7)) : null;
  const trend = last && ref ? round1(last.value - ref.value) : null;
  const key = days === 0 ? 'weekEmpty' : ok >= 5 ? 'weekGreat' : days >= 5 ? 'weekGood' : 'weekStart';
  return { days, ok, protDays, trend, key };
}

/** Catégorie de message pour l'objectif de poids selon l'avancement (0 à 1). */
export function goalKey(frac) {
  return frac >= 1 ? 'goalDone' : frac >= 0.75 ? 'goalNear' : frac >= 0.25 ? 'goalMid' : 'goalStart';
}
