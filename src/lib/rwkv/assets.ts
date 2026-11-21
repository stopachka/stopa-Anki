import manifest from './runtime-assets.json' with { type: 'json' };

const CACHE = 'stopa-anki-rwkv-assets-v1';

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readAsset(file: string, expectedHash: string): Promise<ArrayBuffer> {
  const url = `/models/rwkv/${file}?sha256=${expectedHash}`;
  // Safari can deny storage in private mode or under quota pressure. Inference
  // still works from the fetched bytes; caching is only a download optimization.
  let cache: Cache | undefined;
  try { cache = await caches.open(CACHE); } catch { /* Storage is optional. */ }
  const cached = await cache?.match(url).catch(() => undefined);
  if (cached) {
    try {
      const bytes = await cached.arrayBuffer();
      if (await sha256(bytes) === expectedHash) return bytes;
    } catch { /* An unreadable cached body must not prevent a fresh download. */ }
    await cache?.delete(url).catch(() => false);
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error('Couldn’t download the study model. Check your connection and try again.');
  const bytes = await response.arrayBuffer();
  if (await sha256(bytes) !== expectedHash) throw new Error('The study model download was incomplete. Please try again.');
  try { await cache?.put(url, new Response(bytes.slice(0))); } catch { /* Quota does not prevent studying. */ }
  return bytes;
}

export async function loadModelAssets(): Promise<{ weights: ArrayBuffer; wasm: ArrayBuffer }> {
  const [weights, wasm] = await Promise.all([
    readAsset(manifest.weightsFile, manifest.weightsSha256),
    readAsset(manifest.wasmFile, manifest.wasmSha256),
  ]);
  return { weights, wasm };
}
