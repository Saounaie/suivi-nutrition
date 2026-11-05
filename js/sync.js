// Copie automatique de l'état vers un dépôt GitHub PRIVÉ (fichier data.json), pour que Claude puisse le lire.
// Le jeton reste dans le localStorage de l'appareil : il n'est ni exporté ni envoyé ailleurs qu'à api.github.com.

export function encodeB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function validRepo(s) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(s || '').trim());
}

/**
 * Envoie l'état. Renvoie { ok:true, sha } ou { ok:false, code:'auth'|'notfound'|'network'|'other', message }.
 * `sha` = version précédente du fichier (nécessaire par l'API pour le remplacer) ; on la retrouve seul si elle est périmée.
 */
export async function pushSnapshot(cfg, state, fetchFn = fetch, shaHint = null, now = new Date()) {
  const url = `https://api.github.com/repos/${cfg.repo.trim()}/contents/data.json`;
  const headers = { Authorization: `Bearer ${cfg.token.trim()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const content = encodeB64(JSON.stringify({ ...state, syncedAt: now.toISOString() }, null, 1));
  const message = `Synchro ${now.toISOString().slice(0, 16).replace('T', ' ')}`;
  const put = (sha) => fetchFn(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ message, content, ...(sha ? { sha } : {}) }) });
  try {
    let r = await put(shaHint);
    if (r.status === 409 || r.status === 422) {
      const g = await fetchFn(url, { headers });
      r = await put(g.ok ? (await g.json()).sha : null);
    }
    if (r.status === 401 || r.status === 403) return { ok: false, code: 'auth', message: 'Jeton refusé ou expiré, ou droit « Contents » manquant.' };
    if (r.status === 404) return { ok: false, code: 'notfound', message: "Dépôt introuvable : vérifie son nom et que le jeton y a accès." };
    if (!r.ok) return { ok: false, code: 'other', message: `GitHub a répondu ${r.status}.` };
    return { ok: true, sha: (await r.json()).content?.sha || null };
  } catch (e) {
    return { ok: false, code: 'network', message: 'Pas de connexion pour le moment : nouvel essai au prochain changement.' };
  }
}

/**
 * Lit la copie en ligne. Renvoie { ok:true, state } | { ok:true, empty:true } (aucun fichier) | { ok:false, code, message }.
 * `state` est brut : à passer dans validateState avant usage.
 */
export async function fetchSnapshot(cfg, fetchFn = fetch) {
  const url = `https://api.github.com/repos/${cfg.repo.trim()}/contents/data.json`;
  const headers = { Authorization: `Bearer ${cfg.token.trim()}`, Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' };
  try {
    const r = await fetchFn(url, { headers });
    if (r.status === 404) return { ok: true, empty: true };
    if (r.status === 401 || r.status === 403) return { ok: false, code: 'auth', message: 'Jeton refusé ou expiré, ou droit « Contents » manquant.' };
    if (!r.ok) return { ok: false, code: 'other', message: `GitHub a répondu ${r.status}.` };
    return { ok: true, state: JSON.parse(await r.text()) };
  } catch (e) {
    return { ok: false, code: 'network', message: 'Pas de connexion pour le moment.' };
  }
}

/** Nombre d'éléments de données d'un état (pour comparer deux copies). */
export function dataSize(st) {
  return ['foods', 'entries', 'stock', 'body'].reduce((n, k) => n + (Array.isArray(st?.[k]) ? st[k].length : 0), 0);
}
