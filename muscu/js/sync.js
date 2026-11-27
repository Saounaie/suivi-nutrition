// Copie de l'état Muscu dans le dépôt GitHub PRIVÉ (fichier muscu.json, à côté du data.json de l'appli nutrition),
// pour que Claude puisse le lire. Le jeton reste dans le localStorage de l'appareil.

export const FILE = 'muscu.json';

export function encodeB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function validRepo(s) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(s || '').trim());
}

const headersFor = (cfg, accept) => ({ Authorization: `Bearer ${cfg.token.trim()}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' });
const urlFor = (cfg) => `https://api.github.com/repos/${cfg.repo.trim()}/contents/${FILE}`;
const AUTH = 'Jeton refusé ou expiré, ou droit « Contents » manquant.';

/** Envoie l'état. { ok:true, sha } | { ok:false, code, message }. */
export async function pushSnapshot(cfg, state, fetchFn = fetch, shaHint = null, now = new Date()) {
  const url = urlFor(cfg);
  const headers = headersFor(cfg, 'application/vnd.github+json');
  const content = encodeB64(JSON.stringify({ ...state, syncedAt: now.toISOString() }, null, 1));
  const message = `Muscu ${now.toISOString().slice(0, 16).replace('T', ' ')}`;
  const put = (sha) => fetchFn(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ message, content, ...(sha ? { sha } : {}) }) });
  try {
    let r = await put(shaHint);
    if (r.status === 409 || r.status === 422) {
      const g = await fetchFn(url, { headers });
      r = await put(g.ok ? (await g.json()).sha : null);
    }
    if (r.status === 401 || r.status === 403) return { ok: false, code: 'auth', message: AUTH };
    if (r.status === 404) return { ok: false, code: 'notfound', message: 'Dépôt introuvable : vérifie son nom et que le jeton y a accès.' };
    if (!r.ok) return { ok: false, code: 'other', message: `GitHub a répondu ${r.status}.` };
    return { ok: true, sha: (await r.json()).content?.sha || null };
  } catch (e) {
    return { ok: false, code: 'network', message: 'Pas de connexion pour le moment : nouvel essai au prochain changement.' };
  }
}

/** Lit la copie en ligne. { ok:true, state } | { ok:true, empty:true } | { ok:false, code, message }. */
export async function fetchSnapshot(cfg, fetchFn = fetch) {
  try {
    const r = await fetchFn(urlFor(cfg), { headers: headersFor(cfg, 'application/vnd.github.raw+json') });
    if (r.status === 404) return { ok: true, empty: true };
    if (r.status === 401 || r.status === 403) return { ok: false, code: 'auth', message: AUTH };
    if (!r.ok) return { ok: false, code: 'other', message: `GitHub a répondu ${r.status}.` };
    return { ok: true, state: JSON.parse(await r.text()) };
  } catch (e) {
    return { ok: false, code: 'network', message: 'Pas de connexion pour le moment.' };
  }
}

/** Quantité de données (pour comparer deux copies). */
export function dataSize(st) {
  return ['sessions', 'workouts', 'exercises'].reduce((n, k) => n + (Array.isArray(st?.[k]) ? st[k].length : 0), 0);
}
