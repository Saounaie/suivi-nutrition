import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeB64, validRepo, pushSnapshot, fetchSnapshot, dataSize } from '../js/sync.js';

const cfg = { repo: 'Saounaie/data', token: 'ghp_x' };
const res = (status, json = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => json });

test('encodeB64 gère les accents et grandes chaînes', () => {
  const s = 'Œuf, déjeuner « cantine » 😀';
  assert.equal(Buffer.from(encodeB64(s), 'base64').toString('utf8'), s);
  const big = 'é'.repeat(100000);
  assert.equal(Buffer.from(encodeB64(big), 'base64').toString('utf8').length, 100000);
});

test('validRepo', () => {
  assert.ok(validRepo('Saounaie/suivi-nutrition-data'));
  assert.ok(!validRepo('juste-un-nom'));
  assert.ok(!validRepo('a/b/c'));
  assert.ok(!validRepo(''));
});

test('pushSnapshot : succès, bonne URL, jeton en en-tête, jamais dans le corps', async () => {
  const calls = [];
  const f = async (url, o) => { calls.push({ url, o }); return res(201, { content: { sha: 'abc' } }); };
  const r = await pushSnapshot(cfg, { v: 1, foods: [] }, f);
  assert.deepEqual(r, { ok: true, sha: 'abc' });
  assert.equal(calls[0].url, 'https://api.github.com/repos/Saounaie/data/contents/data.json');
  assert.equal(calls[0].o.headers.Authorization, 'Bearer ghp_x');
  assert.ok(!calls[0].o.body.includes('ghp_x'));
  assert.ok(!('sha' in JSON.parse(calls[0].o.body)));
});

test('pushSnapshot : sha périmé (422) -> relit le sha puis réessaie', async () => {
  let n = 0;
  const f = async (url, o) => {
    n++;
    if (o.method === 'PUT' && n === 1) return res(422);
    if (!o.method) return res(200, { sha: 'nouveau' });
    assert.equal(JSON.parse(o.body).sha, 'nouveau');
    return res(200, { content: { sha: 'fin' } });
  };
  assert.deepEqual(await pushSnapshot(cfg, {}, f, 'vieux'), { ok: true, sha: 'fin' });
  assert.equal(n, 3);
});

test('pushSnapshot : erreurs lisibles', async () => {
  assert.equal((await pushSnapshot(cfg, {}, async () => res(401))).code, 'auth');
  assert.equal((await pushSnapshot(cfg, {}, async () => res(404))).code, 'notfound');
  assert.equal((await pushSnapshot(cfg, {}, async () => res(500))).code, 'other');
  assert.equal((await pushSnapshot(cfg, {}, async () => { throw new Error('offline'); })).code, 'network');
});

test('fetchSnapshot : fichier, absence, erreurs', async () => {
  const ok = await fetchSnapshot(cfg, async (u, o) => { assert.match(o.headers.Accept, /raw/); return { status: 200, ok: true, text: async () => '{"v":1,"foods":[1]}' }; });
  assert.deepEqual(ok, { ok: true, state: { v: 1, foods: [1] } });
  assert.deepEqual(await fetchSnapshot(cfg, async () => res(404)), { ok: true, empty: true });
  assert.equal((await fetchSnapshot(cfg, async () => res(401))).code, 'auth');
  assert.equal((await fetchSnapshot(cfg, async () => { throw new Error('x'); })).code, 'network');
});

test('dataSize', () => {
  assert.equal(dataSize({ foods: [1, 2], entries: [1], stock: [], body: [1] }), 4);
  assert.equal(dataSize(null), 0);
  assert.equal(dataSize({}), 0);
});
