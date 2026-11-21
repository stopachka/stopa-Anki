import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadModelAssets } from './assets.ts';
import manifest from './runtime-assets.json' with { type: 'json' };

const [weights, wasm] = await Promise.all([
  readFile(new URL(`../../../public/models/rwkv/${manifest.weightsFile}`, import.meta.url)),
  readFile(new URL(`../../../public/models/rwkv/${manifest.wasmFile}`, import.meta.url)),
]);

for (const cacheFailure of ['unreadable body', 'incorrect bytes', 'unavailable storage'] as const) {
  test(`model assets recover from ${cacheFailure} without requiring a manual cache clear`, async t => {
    let downloads = 0;
    let deletions = 0;
    let writes = 0;
    const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
    Object.defineProperty(globalThis, 'caches', { configurable: true, value: {
      open: async () => {
        if (cacheFailure === 'unavailable storage') throw new Error('Storage denied');
        return {
          match: async () => cacheFailure === 'unreadable body'
            ? { arrayBuffer: async () => { throw new Error('Cached body cannot be read'); } }
            : new Response(new Uint8Array([1, 2, 3])),
          delete: async () => { deletions += 1; return true; },
          put: async () => { writes += 1; },
        };
      },
    } });
    t.after(() => {
      if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
      else Reflect.deleteProperty(globalThis, 'caches');
    });
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      downloads += 1;
      const bytes = String(input).includes(manifest.weightsFile) ? weights : wasm;
      return new Response(new Uint8Array(bytes));
    });
    const actual = await loadModelAssets();
    assert.deepEqual(new Uint8Array(actual.weights), new Uint8Array(weights));
    assert.deepEqual(new Uint8Array(actual.wasm), new Uint8Array(wasm));
    assert.equal(downloads, 2);
    assert.equal(deletions, cacheFailure === 'unavailable storage' ? 0 : 2);
    assert.equal(writes, cacheFailure === 'unavailable storage' ? 0 : 2);
  });
}
