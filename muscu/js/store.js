// Stockage local : tout l'état Muscu dans une entrée IndexedDB, base séparée de l'appli nutrition (repli localStorage).
import { validateState, freshState } from './logic.js';

const DB = 'suivi-muscu';
const KEY = 'state';
const LS_KEY = 'muscu.state';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction('kv', mode);
    const r = fn(t.objectStore('kv'));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  }));
}

export async function loadState() {
  try {
    const saved = await tx('readonly', (s) => s.get(KEY));
    if (saved) return validateState(saved);
  } catch (e) {
    try {
      const ls = localStorage.getItem(LS_KEY);
      if (ls) return validateState(JSON.parse(ls));
    } catch (_) { /* ignore */ }
  }
  return freshState();
}

export async function saveState(state) {
  const copy = JSON.parse(JSON.stringify(state));
  try { await tx('readwrite', (s) => s.put(copy, KEY)); return true; } catch (e) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(copy)); return true; } catch (_) { return false; }
  }
}

export async function askPersistent() {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch (_) { return false; }
}
