# stopa-Anki

[Open the app](https://stopa-anki.vercel.app) · [Source on GitHub](https://github.com/stopachka/stopa-Anki)

A minimal, mobile-first Chinese study app built with React, TypeScript, and Vite. Choose a book, practice the traditional Chinese word, then tap the study screen outside the writing pad and controls. Taps in the writing pad make dots; dragging draws a stroke. An invisible 24-pixel buffer around the pad absorbs nearby taps. The card flips to the character, pinyin, and English meaning together, with recall ratings at the bottom. Tap the answer to return to the question; your handwriting stays intact. The front has a writing pad with a faint Hanzi stroke guide that repeats automatically while you draw, pausing briefly between loops. Automatic animation respects reduced-motion preferences and pauses on the answer side. Drawing is optional practice; it is not automatically graded.

## Run locally

Requires Node.js 24 or later.

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite. The dev server also listens on the local network for testing on a phone connected to the same network.

```sh
npm run build
npm test
```

The build checks TypeScript and creates `dist/`. Tests cover model inference, review-history features, scheduling, and review selection. `npm run preview` serves the production build locally. The compiled WebAssembly module is checked in; Rust is needed only to rebuild the inference engine.

## Deployment

Vercel deploys the `main` branch of this repository to [stopa-anki.vercel.app](https://stopa-anki.vercel.app). Build settings are checked in as `vercel.json`: install with `npm ci`, build with `npm run build`, and serve `dist/`.

The hosted app uses the same InstantDB app as local development. Sign in with the same email to access your saved reviews. No OpenAI or Instant admin key is needed by the website. For an independent fork, use your own Instant app ID in `src/lib/db.ts` and apply the included schema and permissions to that app.

## Vocabulary and scheduling

The vocabulary is stored as plain JSON files in `public/data/`: Book 1 has 292 entries, Book 2 has 467, and Book 3 has 1,028, for 1,787 entries total. These preserve the traditional characters, pinyin, meanings, and chapter order from the reconstructed Olle Linge PAVC decks. See [vocabulary provenance](public/data/README.md).

Review selection uses the pretrained **RWKV Big Instant-Only SM99** model, running on the browser's CPU through WebAssembly SIMD in a background worker. The model predicts the probability of recalling each studied word from review history. Review-state cards become eligible at **90% recall or below**, with the lowest predicted recall first, independently of their saved FSRS due dates. The four review buttons rate recall of the word's meaning; vocabulary text and handwriting are not model inputs. No inference server or API key is used. See [model assets, source, and build instructions](public/models/rwkv/README.md).

Learning still uses 1- and 10-minute steps and a 1-minute relearning step. Due learning takes priority, then eligible RWKV reviews, then new words in textbook order. When that queue is empty, learning cards within 20 minutes can appear early. A **60-second minimum since the last answer** applies to both review and learning cards, including learn-ahead, to prevent immediate repeats. Counts use these same rules. The 60-second guard is this app's configuration, not a claim about the upstream default. The app does not impose an intervening-review minimum or daily review floor.

The TypeScript port of the app-relevant **Anki 26.09.4** scheduler remains responsible for learning transitions and compatible FSRS memory/due-date metadata, pinned to [commit `c06370f`](https://github.com/ankitects/anki/tree/c06370ff4d87cb48d825f90cc83e02b9a4e84ecd/rslib/src/scheduler). Its FSRS-6 math comes from `fsrs` Rust crate 6.6.2, with 90% desired retention, interval fuzz, and a 36,500-day maximum interval. Those fallback due dates do not control RWKV review eligibility. SM99's curve head is untrained and never used; answer buttons therefore do not promise fixed review intervals. This app does not implement every feature of Anki or the experimental RWKV fork.

The default allowance is **10 new words per day across all three books**. Settings beside the home refresh icon adjusts this from 0 to 999 and syncs it with your account. A word consumes one slot when first rated; repeat learning/review answers do not consume another slot. Existing first-review history counts toward today's allowance. It resets at **4am in the device's local timezone**, matching Anki's default study-day boundary, without carrying unused slots forward. Blue counts show the available new words today, while progress bars still measure all words started. Eligible reviews remain available after the new-word limit is reached.

Handwriting practice shows a whole word on one continuous surface: two or three characters side by side, with longer phrases wrapping. Stroke guides animate through the word and repeat. Tap outside the pad to flip; undo and clear affect the whole drawing. Text selection and touch callouts are disabled during study.

Card states and the complete review history are stored in **InstantDB**, linked to your signed-in account. Rating a card saves its compatible FSRS state and review event together before moving on; if saving fails, the revealed card stays available to retry. New review events also record when the card appeared and the active answer duration, capped at 60 seconds and excluding time spent with the page hidden. Offline writes use InstantDB's local queue and the app shows “Waiting to sync” while confirmation is pending. Sign out and a refresh icon are available on the books page.

Existing progress and reviews are retained. The worker reconstructs all five recurrent scopes—card, note, deck, preset, and user—from the chronological review log. New answers extend the loaded state; inserted, deleted, or changed historical events trigger a rebuild. Account changes dispose of the worker. Queries do not commit state, and the app waits for valid predictions before selecting the next card instead of silently switching to a different scheduler. The model weights stay fixed during study; answering updates recurrent state, not the pretrained parameters.

Older reviews have no recorded duration and use the native runtime's unknown-duration encoding (normalized zero, distinct from a measured zero milliseconds). Calendar features use UTC days for deterministic cross-device replay; this is an approximation relative to training's local study-day boundaries and is separate from the app's 4am daily allowance. Entity codes use deterministic per-ID hashes instead of the reference's first-seen random generator. The model and these feature conventions are versioned in the source.

The approximately 11 MB weight file and 96 KiB WebAssembly module are cached in browser Cache Storage when available and verified by SHA-256. Inference uses **FP32 weights and state**; compressed-state memory estimates do not describe this configuration. State is allocated for studied words only, reaching approximately 156 MB of raw recurrent values if all 1,787 words have been studied, plus model/runtime overhead. Model assets are cached, but the app does not yet provide a complete offline asset cache or guaranteed offline startup. Review logs still sync with InstantDB; no separate service receives them for inference.

## Scheduler verification

`npm test` verifies the actual bundled WebAssembly engine against independent NumPy-reference fixtures from the published SM99 package. The committed inference fixture contains 768 synthetic query/update rows across two users, and the first 24 numeric input features are checked against 1,024 official synthetic rows at a `2e-6` tolerance. Tests also cover query non-mutation, replay ordering, account isolation, changed-history rebuilds, model-driven selection, repeat spacing, and daily limits. The synthetic fixtures contain no user or training-dataset records. Passing these checks establishes numerical and integration compatibility for the covered cases, not improved learning outcomes or a measured iPhone latency.

The retained Anki-port tests compare learning transitions, FSRS metadata, interval fuzz, and the underlying Anki queue helpers with fixtures generated by the unmodified official Anki 26.09.4 Python package, which calls Anki's Rust core. Floating-point memory values use a small tolerance; integer scheduling outcomes are compared exactly. These fixtures verify the fallback scheduler components, not that active RWKV review selection is identical to Anki's default scheduler.

To rebuild the WebAssembly engine after changing `scripts/rwkv/runtime.rs`, install Rust's `wasm32-unknown-unknown` target and run:

```sh
node scripts/rwkv/build.mjs
npm test
```

The model's [pinned release and checksums](public/models/rwkv/README.md) identify the independent reference package. With NumPy installed, regenerate the inference fixtures using `python scripts/rwkv-oracle.py /path/to/rwkv-big-instant-only`. The default keeps 384 rows per synthetic user; `--rows` and `--output` support a separate longer verification run.

To regenerate the reference fixtures, use a separate Python environment with `anki==26.09.4` installed, then run:

```sh
python scripts/anki-reference.py
python scripts/anki-reference.py --fuzz
npm test
```

The generator creates disposable collections in temporary directories and never opens a user's Anki collection. The fixture source metadata records the reference version, commit, timezone and fuzz mode.

## Pronunciation audio

The speaker icon plays local, pre-generated OpenAI audio from `public/audio-openai/`, indexed by the exact `traditional|pinyin` pair. The current generation scope is **Book 1 only**: 287 unique recordings cover its 292 cards. Books 2 and 3 do not yet have generated audio. These are AI-generated pronunciations, not human recordings; pronunciation quality, tones, and alternate readings still need listening review.

The browser only reads the saved MP3s and manifest. It never receives an API key or calls the generation API. To generate or resume Book 1 audio, provide `OPENAI_API_KEY` in the generator’s shell environment, then run:

```sh
node scripts/generate-audio.mjs --book 1 --concurrency 8
```

Keep `--book 1` to limit the generation scope. Use `--limit 5` for a sample, or `--dry-run --book 1` to inspect coverage without API calls. Never put the key in frontend code, a committed file, or a `VITE_` environment variable. See the [audio README](public/audio-openai/README.md) for generation details and model lifecycle notes.

## Stroke guides

Hanzi Writer loads bundled character data from `public/hanzi/`, without a runtime CDN request. All 1,043 unique Han characters in the decks have stroke data. Traditional-character coverage does not guarantee that every glyph or stroke order matches Taiwan’s standards. See the [stroke data README and licenses](public/hanzi/README.md).

## License and source

The application code is licensed under **GNU AGPL version 3 or later**; see [LICENSE](LICENSE). Anki-derived scheduler files retain Ankitects' attribution. The FSRS scalar port retains its BSD-3-Clause terms, and the random-number compatibility code retains its MIT notice. See [third-party notices](THIRD_PARTY_NOTICES.md) for the source versions, modifications and license copies.

The application license does **not** grant rights to the pretrained model weights, vocabulary, generated audio, or third-party stroke data. Their provenance and applicable terms remain in their respective directories, including the model's unchanged [upstream weights notice](public/models/rwkv/WEIGHTS-NOTICE.md). The weights' redistribution terms remain unresolved upstream; the reference code's MIT license does not cover them. No redistribution license for the source vocabulary lists has been established either. This is an independent personal study project, not an official Anki application. Complete application source and build instructions are available in [this public repository](https://github.com/stopachka/stopa-Anki); the app's source icon links here.
