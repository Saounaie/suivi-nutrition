// Stockage local : tout l'état dans une seule entrée IndexedDB (repli localStorage).
import { validateState } from './logic.js';

const DB = 'suivi-nutrition';
const KEY = 'state';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction('kv').objectStore('kv').get(KEY);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idbSet(value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function freshState() {
  return {
    v: 1,
    settings: { kcal: 1900, prot: 115, theme: 'dark' },
    foods: [],
    entries: [],
    stock: [],
  };
}

export async function loadState() {
  try {
    const saved = await idbGet();
    if (saved) return validateState(saved);
  } catch (e) {
    try {
      const ls = localStorage.getItem(KEY);
      if (ls) return validateState(JSON.parse(ls));
    } catch (_) { /* ignore */ }
  }
  return freshState();
}

export async function saveState(state) {
  try {
    await idbSet(JSON.parse(JSON.stringify(state)));
    return true;
  } catch (e) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (_) { return false; }
  }
}

export async function askPersistent() {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch (_) { return false; }
}
