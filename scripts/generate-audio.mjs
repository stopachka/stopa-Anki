#!/usr/bin/env node
/**
 * Generate static Mandarin audio. No API key is saved, logged, or sent to Vite.
 * Official API reference checked 2026-11-19:
 * https://developers.openai.com/api/docs/guides/text-to-speech
 * The Speech API model is supported until its announced 2027-01-06 shutdown.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(projectDir, 'public', 'audio-openai');
const manifestPath = join(outputDir, 'manifest.json');
const API_URL = 'https://api.openai.com/v1/audio/speech';
const PROMPT_VERSION = 1;
const args = process.argv.slice(2);

function option(name, fallback) {
  const position = args.indexOf(name);
  if (position === -1) return fallback;
  const value = args[position + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}

if (args.includes('--help')) {
  console.log(`Generate local Mandarin vocabulary MP3s with the OpenAI Speech API.

Usage: node scripts/generate-audio.mjs [options]

Environment: OPENAI_API_KEY (required only for generation; never printed or saved)

  --dry-run             Validate input and show missing recordings; make no API calls
  --limit N             Generate at most N missing recordings this run
  --concurrency N       Parallel requests, 1–8 (default 4)
  --book N              Limit this run to book 1, 2, or 3
  --voice NAME          Built-in voice (default marin)
  --model NAME          Speech API model (default gpt-4o-mini-tts-2025-12-15)

Existing matching files are reused. Progress is saved after every success.
Run a small --limit 5 sample and listen before generating the complete set.
Speech models are announced to shut down on 2027-01-06; future generation will
need an API migration. Existing static audio will continue to play normally.`);
  process.exit(0);
}

const dryRun = args.includes('--dry-run');
const concurrency = Number(option('--concurrency', '4'));
const limit = Number(option('--limit', 'Infinity'));
const selectedBook = Number(option('--book', '0'));
const voice = option('--voice', 'marin');
const model = option('--model', 'gpt-4o-mini-tts-2025-12-15');
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('--concurrency must be an integer from 1 to 8');
if (!(limit === Infinity || Number.isInteger(limit) && limit > 0)) throw new Error('--limit must be a positive integer');
if (![0, 1, 2, 3].includes(selectedBook)) throw new Error('--book must be 1, 2, or 3');
if (!['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse', 'marin', 'cedar'].includes(voice)) throw new Error('Unknown built-in voice');
if (!/^gpt-4o-mini-tts(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) throw new Error('This generator uses a Speech API model with instructions; Realtime models need a different API');

const books = await Promise.all([1, 2, 3].map(async book => JSON.parse(await readFile(join(projectDir, 'public', 'data', `book-${book}.json`), 'utf8'))));
const allWords = books.flat();
const unique = new Map();
for (const word of allWords) {
  if (![word.traditional, word.pinyin, word.english].every(text => typeof text === 'string' && text.trim())) throw new Error(`Incomplete word record ${word.id}`);
  if (selectedBook && word.book !== selectedBook) continue;
  const key = `${word.traditional}|${word.pinyin}`;
  if (!unique.has(key)) unique.set(key, word);
}

function requestFor(word) {
  return {
    model, voice, input: word.traditional, response_format: 'mp3', speed: 0.9,
    instructions: [
      'Speak only the supplied Chinese vocabulary once, in clear, natural Taiwanese Mandarin, as a patient language teacher.',
      'Use a calm, neutral delivery and a slightly measured pace. Preserve the correct tones and natural tone sandhi. No music or sound effects.',
      `The intended pronunciation is ${word.pinyin}. Use this pronunciation to disambiguate characters with multiple readings.`,
      `Meaning for disambiguation only: ${word.english}.`,
      'Do not say the pinyin, English meaning, instructions, introductory words, or any explanation. Do not repeat the vocabulary.',
    ].join(' '),
  };
}

function fingerprintFor(word) {
  return createHash('sha256').update(JSON.stringify({ version: PROMPT_VERSION, ...requestFor(word) })).digest('hex');
}

function isMp3(buffer) {
  return buffer.length > 512 && (buffer.subarray(0, 3).toString() === 'ID3' || buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
}

const canProbe = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
function probeDuration(path) {
  if (!canProbe) return null;
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path], { encoding: 'utf8' });
  const duration = Number(result.stdout?.trim());
  if (result.status !== 0 || !Number.isFinite(duration) || duration < 0.15 || duration > 15) throw new Error('Audio duration check failed; recording needs review');
  return duration;
}

let manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : {};
if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') throw new Error('Existing audio manifest is invalid');
const jobs = [];
let reused = 0;
for (const [key, word] of unique) {
  const fingerprint = fingerprintFor(word);
  const filename = `${fingerprint.slice(0, 24)}.mp3`;
  const path = join(outputDir, filename);
  const entry = manifest[key];
  // Audited replacements may use a carrier phrase + trim or another built-in voice.
  // They are deliberately preserved instead of reverting to a less reliable draft.
  // An explicit --model/--voice still requests that matching generation setting.
  const verifiedFilename = typeof entry?.src === 'string' && /^\/audio-openai\/[a-zA-Z0-9._-]+\.mp3$/.test(entry.src)
    ? entry.src.split('/').at(-1) : null;
  const verifiedPath = verifiedFilename ? join(outputDir, verifiedFilename) : null;
  const verifiedRecording = entry?.qualityChecked === true && entry?.aiGenerated === true
    && entry.traditional === word.traditional && entry.pinyin === word.pinyin
    && (!args.includes('--voice') || entry.voice === voice)
    && (!args.includes('--model') || entry.model === model)
    && verifiedPath && existsSync(verifiedPath) && isMp3(await readFile(verifiedPath));
  if (verifiedRecording || entry?.fingerprint === fingerprint && entry.src === `/audio-openai/${filename}` && existsSync(path) && isMp3(await readFile(path))) {
    reused++;
  } else {
    jobs.push({ key, word, fingerprint, filename, path });
  }
}
const todo = jobs.slice(0, limit);
console.log(JSON.stringify({ dryRun, cards: selectedBook ? books[selectedBook - 1].length : allWords.length, unique: unique.size, ready: reused, missing: jobs.length, thisRun: todo.length, model, voice, concurrency, canProbe }, null, 2));
if (dryRun) process.exit(0);
if (!todo.length) { console.log('All requested recordings are already present.'); process.exit(0); }
const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error('Set OPENAI_API_KEY in the environment before generation. No API calls were made.');
await mkdir(outputDir, { recursive: true });

// Serialize manifest snapshots so parallel completions cannot lose one another.
let saveChain = Promise.resolve();
const saveManifest = () => {
  saveChain = saveChain.then(async () => {
    const temporary = `${manifestPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(temporary, manifestPath);
  });
  return saveChain;
};

const stopController = new AbortController();
let stopping = false;
let fatalError = null;
let completed = 0;
let cursor = 0;
const failures = [];
process.on('SIGINT', () => {
  if (stopping) process.exit(130);
  stopping = true;
  console.log('Stopping after current requests; completed recordings are preserved.');
});
process.on('SIGTERM', () => { stopping = true; });

class APIError extends Error {
  constructor(status, code, retryAfter = null) {
    super(`OpenAI request failed (${status}; ${code || 'unspecified_error'})`);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.fatal = [401, 403, 404].includes(status) || /insufficient_quota|billing|budget|invalid_api_key|model_not_found|permission/i.test(code ?? '');
    this.retryable = !this.fatal && (status === 429 || status >= 500);
  }
}

async function requestAudio(word) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(requestFor(word)),
        signal: AbortSignal.any([stopController.signal, AbortSignal.timeout(90_000)]),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        // Never log server error messages, which can echo an invalid credential.
        const safeCode = String(body.error?.code ?? body.error?.type ?? '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 80);
        throw new APIError(response.status, safeCode, response.headers.get('retry-after'));
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!isMp3(buffer)) throw new Error('Speech endpoint returned an invalid or empty MP3');
      return buffer;
    } catch (error) {
      if (stopController.signal.aborted) throw error;
      const retryable = error instanceof APIError ? error.retryable : error.name === 'TimeoutError' || error instanceof TypeError;
      if (!retryable || attempt === 4) throw error;
      const seconds = Number(error.retryAfter);
      const waitMs = Number.isFinite(seconds) && seconds > 0 ? Math.min(60_000, seconds * 1000) : Math.min(30_000, 1000 * 2 ** attempt + Math.random() * 750);
      await delay(waitMs, undefined, { signal: stopController.signal });
    }
  }
}

async function runJob(job) {
  // Recover an orphaned valid file if the process ended between audio and manifest writes.
  let buffer = existsSync(job.path) ? await readFile(job.path) : null;
  if (!buffer || !isMp3(buffer)) {
    buffer = await requestAudio(job.word);
    const temporary = `${job.path}.tmp`;
    await writeFile(temporary, buffer);
    try { probeDuration(temporary); } catch (error) { await unlink(temporary); throw error; }
    await rename(temporary, job.path);
  }
  const durationSeconds = probeDuration(job.path);
  const fileStat = await stat(job.path);
  manifest[job.key] = {
    src: `/audio-openai/${job.filename}`,
    source: 'OpenAI',
    model, voice,
    variant: 'AI-generated Mandarin; Taiwanese pronunciation requested',
    aiGenerated: true,
    traditional: job.word.traditional,
    pinyin: job.word.pinyin,
    fingerprint: job.fingerprint,
    promptVersion: PROMPT_VERSION,
    bytes: buffer.length,
    durationSeconds,
    generatedAt: fileStat.mtime.toISOString(),
  };
  await saveManifest();
  completed++;
  console.log(`[${completed}/${todo.length}] ${job.word.traditional} · ${job.word.pinyin}${durationSeconds ? ` · ${durationSeconds.toFixed(2)}s` : ''}`);
}

async function worker() {
  while (!stopping && !fatalError && cursor < todo.length) {
    const job = todo[cursor++];
    try { await runJob(job); }
    catch (error) {
      if (stopController.signal.aborted) return;
      const summary = error instanceof APIError ? error.message : String(error.message ?? 'Unexpected error').replace(/sk-[\w-]+/g, '[redacted]');
      failures.push({ key: job.key, error: summary });
      console.error(`Failed ${job.word.traditional}: ${summary}`);
      if (error.fatal || error instanceof APIError && !error.retryable || failures.length >= 5) {
        fatalError = summary;
        stopController.abort();
      }
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
await saveChain;
console.log(JSON.stringify({ completed, reused, failed: failures.length, stopped: stopping || Boolean(fatalError), remainingInSelection: unique.size - reused - completed }, null, 2));
if (failures.length) {
  await writeFile(join(outputDir, 'generation-errors.json'), `${JSON.stringify({ updatedAt: new Date().toISOString(), failures }, null, 2)}\n`);
  process.exitCode = 1;
}
