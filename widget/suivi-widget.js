// Widget « Suivi nutrition » pour l'appli Scriptable (iPhone). Voir LISEZ-MOI.md pour l'installation.
// Il lit la copie de tes données (data.json) dans ton dépôt GitHub privé, calcule ta journée et dessine l'anneau des calories.

const APP_URL = ''; // facultatif : adresse de l'appli, ouverte quand on touche le widget
const CACHE = 'suivi-cache.json';

/* ---------- Calcul (pur, testable avec node) ---------- */

function isoOf(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Résume la journée `today` (AAAA-MM-JJ) à partir de l'état de l'appli. */
function summarize(state, today) {
  const s = state.settings || {};
  const budget = Number(s.kcal) || 1900, protGoal = Number(s.prot) || 115;
  const t = { kcal: 0, prot: 0, carbs: 0, fat: 0 };
  for (const e of state.entries || []) {
    if (e.date !== today) continue;
    for (const k of Object.keys(t)) t[k] += Number(e[k]) || 0;
  }
  const w = [...(state.body || [])].reverse().find((b) => b.weight != null);
  return {
    budget, protGoal,
    kcal: Math.round(t.kcal), left: Math.round(budget - t.kcal),
    prot: Math.round(t.prot), carbs: Math.round(t.carbs), fat: Math.round(t.fat),
    pct: budget > 0 ? t.kcal / budget : 0, protPct: protGoal > 0 ? t.prot / protGoal : 0,
    weight: w ? w.weight : null, goal: s.goalWeight ?? null,
    syncedAt: state.syncedAt || null,
  };
}

/* ---------- Données : GitHub, avec copie locale en secours ---------- */

async function loadState() {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.documentsDirectory(), CACHE);
  const repo = Keychain.contains('suivi_repo') ? Keychain.get('suivi_repo') : null;
  const token = Keychain.contains('suivi_token') ? Keychain.get('suivi_token') : null;
  if (!repo || !token) return { error: "Ouvre le script dans Scriptable pour le configurer." };
  try {
    const req = new Request(`https://api.github.com/repos/${repo}/contents/data.json`);
    req.headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const txt = await req.loadString();
    if (req.response.statusCode !== 200) throw new Error(`GitHub ${req.response.statusCode}`);
    const state = JSON.parse(txt);
    fm.writeString(path, txt);
    return { state, fresh: true };
  } catch (e) {
    if (fm.fileExists(path)) return { state: JSON.parse(fm.readString(path)), fresh: false };
    return { error: 'Données introuvables. Vérifie la synchronisation dans l\'appli.' };
  }
}

async function configure() {
  const a = new Alert();
  a.title = 'Configurer le widget';
  a.message = 'Dépôt privé qui contient data.json, et un jeton GitHub en lecture seule (droit « Contents : Read-only »). Ils sont gardés dans le trousseau de l\'iPhone.';
  a.addTextField('compte/nom-du-depot', Keychain.contains('suivi_repo') ? Keychain.get('suivi_repo') : '');
  a.addSecureTextField('jeton github_pat_…', '');
  a.addAction('Enregistrer'); a.addCancelAction('Annuler');
  if ((await a.present()) !== 0) return false;
  const repo = a.textFieldValue(0).trim(), token = a.textFieldValue(1).trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { const e = new Alert(); e.title = 'Dépôt invalide'; e.message = 'Écris-le sous la forme compte/nom.'; e.addAction('OK'); await e.present(); return false; }
  Keychain.set('suivi_repo', repo);
  if (token) Keychain.set('suivi_token', token);
  return true;
}

/* ---------- Dessin ---------- */

const C = {
  bg: new Color('#0b0f0d'), card: new Color('#141a17'), text: new Color('#f2f5f1'), muted: new Color('#98a59c'),
  accent: new Color('#6ee7a8'), warn: new Color('#ffb454'), danger: new Color('#ff7a7a'), prot: new Color('#6aa8ff'),
  track: new Color('#ffffff', 0.1),
};

function ringImage(sum, size = 260, line = 30) {
  const dc = new DrawContext();
  dc.size = new Size(size, size); dc.opaque = false; dc.respectScreenScale = true;
  const r = (size - line) / 2, c = size / 2;
  const dot = (deg, col) => {
    const a = ((deg - 90) * Math.PI) / 180;
    dc.setFillColor(col);
    dc.fillEllipse(new Rect(c + r * Math.cos(a) - line / 2, c + r * Math.sin(a) - line / 2, line, line));
  };
  for (let d = 0; d < 360; d += 2) dot(d, C.track);
  const color = sum.pct > 1.1 ? C.danger : sum.pct > 1 ? C.warn : C.accent;
  const end = Math.round(360 * Math.min(1, sum.pct));
  for (let d = 0; d <= end; d += 2) dot(d, color);
  dc.setTextAlignedCenter();
  dc.setTextColor(C.text);
  dc.setFont(Font.boldRoundedSystemFont(size * 0.26));
  dc.drawTextInRect(String(Math.abs(sum.left)), new Rect(0, size * 0.28, size, size * 0.3));
  dc.setTextColor(C.muted);
  dc.setFont(Font.mediumSystemFont(size * 0.095));
  dc.drawTextInRect(sum.left >= 0 ? 'kcal restantes' : 'au-dessus', new Rect(0, size * 0.58, size, size * 0.15));
  return dc.getImage();
}

function bar(stack, pct, color, width, height = 6) {
  const dc = new DrawContext();
  dc.size = new Size(width, height); dc.opaque = false; dc.respectScreenScale = true;
  dc.setFillColor(C.track); dc.fillRect(new Rect(0, 0, width, height));
  dc.setFillColor(color); dc.fillRect(new Rect(0, 0, Math.max(0, Math.min(1, pct)) * width, height));
  const img = stack.addImage(dc.getImage());
  img.imageSize = new Size(width / 2, height / 2);
  img.cornerRadius = height / 4;
}

function line(stack, label, value, color) {
  const row = stack.addStack(); row.centerAlignContent();
  const l = row.addText(label); l.font = Font.mediumSystemFont(11); l.textColor = color || C.muted;
  row.addSpacer();
  const v = row.addText(value); v.font = Font.semiboldRoundedSystemFont(13); v.textColor = C.text;
}

function build(res, family) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(14, 14, 12, 14);
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  if (APP_URL) w.url = APP_URL;
  if (res.error) {
    const t = w.addText(res.error); t.font = Font.mediumSystemFont(13); t.textColor = C.muted;
    return w;
  }
  const sum = summarize(res.state, isoOf(new Date()));
  const small = family === 'small';
  const row = w.addStack(); row.centerAlignContent(); row.spacing = 14;
  const img = row.addImage(ringImage(sum));
  img.imageSize = small ? new Size(120, 120) : new Size(112, 112);
  if (!small) {
    const col = row.addStack(); col.layoutVertically(); col.spacing = 5;
    const head = col.addText(`${sum.kcal} / ${sum.budget} kcal`);
    head.font = Font.boldRoundedSystemFont(17); head.textColor = C.text;
    line(col, 'Protéines', `${sum.prot} / ${sum.protGoal} g`, C.prot);
    bar(col, sum.protPct, C.prot, 300);
    line(col, 'Glucides', `${sum.carbs} g`);
    line(col, 'Lipides', `${sum.fat} g`);
    if (sum.weight != null) line(col, 'Poids', `${String(sum.weight).replace('.', ',')} kg${sum.goal ? ` → ${String(sum.goal).replace('.', ',')}` : ''}`);
  }
  w.addSpacer();
  const when = sum.syncedAt ? new Date(sum.syncedAt) : null;
  const foot = w.addText(res.fresh ? (when ? `Données de ${when.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '') : 'Hors ligne : dernières données connues');
  foot.font = Font.systemFont(9); foot.textColor = res.fresh ? C.muted : C.warn;
  return w;
}

async function main() {
  if (config.runsInApp && !Keychain.contains('suivi_token')) await configure();
  const res = await loadState();
  const family = config.widgetFamily || 'medium';
  const w = build(res, family);
  if (config.runsInWidget) Script.setWidget(w);
  else {
    // Dans l'appli : propose de reconfigurer, puis montre un aperçu.
    const menu = new Alert(); menu.title = 'Suivi nutrition';
    menu.addAction('Aperçu moyen'); menu.addAction('Aperçu petit'); menu.addAction('Reconfigurer'); menu.addCancelAction('Fermer');
    const i = await menu.present();
    if (i === 0) await w.presentMedium();
    else if (i === 1) await build(res, 'small').presentSmall();
    else if (i === 2) { if (await configure()) await build(await loadState(), 'medium').presentMedium(); }
  }
  Script.complete();
}

if (typeof Script !== 'undefined') main();
else if (typeof module !== 'undefined') module.exports = { summarize, isoOf };
