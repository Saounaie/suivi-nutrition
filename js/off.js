// Client Open Food Facts : lecture seule, sans clé. Limite officielle : 15 requêtes produit / minute / IP.
import { mapOffProduct, normalizeBarcode } from './logic.js';

const FIELDS = 'code,product_name,product_name_fr,brands,serving_quantity,product_quantity,nutriments';

/** Renvoie { status: 'found', food } | { status: 'unknown' } | { status: 'error' } (hors ligne, limite atteinte…). */
export async function lookupBarcode(code, fetchFn = fetch) {
  const c = normalizeBarcode(code);
  if (c.length < 8) return { status: 'unknown' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetchFn(`https://world.openfoodfacts.org/api/v2/product/${c}.json?fields=${FIELDS}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (r.status === 404) return { status: 'unknown' };
    if (!r.ok) return { status: 'error' };
    const food = mapOffProduct(await r.json(), c);
    return food ? { status: 'found', food } : { status: 'unknown' };
  } catch (e) {
    return { status: 'error' };
  }
}
