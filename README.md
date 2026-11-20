# stopa-Anki

[Open the app](https://stopa-anki.vercel.app) · [Source on GitHub](https://github.com/stopachka/stopa-Anki)

A minimal, mobile-first Chinese study app built with React, TypeScript, and Vite. Choose a book, practice the traditional Chinese word, then tap anywhere on the study screen outside the controls. A quick tap in the writing area also flips the card; dragging draws a stroke. The card flips to the character, pinyin, and English meaning together, with recall ratings at the bottom. Tap the answer to return to the question; your handwriting stays intact. The front has a writing pad with a faint Hanzi stroke guide that repeats automatically while you draw, pausing briefly between loops. Automatic animation respects reduced-motion preferences and pauses on the answer side. Drawing is optional practice; it is not automatically graded.

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

The build checks TypeScript and creates `dist/`. Tests cover the scheduling and review-selection behavior. `npm run preview` serves the production build locally.

## Deployment

Vercel deploys the `main` branch of this repository to [stopa-anki.vercel.app](https://stopa-anki.vercel.app). Build settings are checked in as `vercel.json`: install with `npm ci`, build with `npm run build`, and serve `dist/`.

The hosted app uses the same InstantDB app as local development. Sign in with the same email to access your saved reviews. No OpenAI or Instant admin key is needed by the website. For an independent fork, use your own Instant app ID in `src/lib/db.ts` and apply the included schema and permissions to that app.

## Vocabulary and scheduling

The vocabulary is stored as plain JSON files in `public/data/`: Book 1 has 292 entries, Book 2 has 467, and Book 3 has 1,028, for 1,787 entries total. These preserve the traditional characters, pinyin, meanings, and chapter order from the reconstructed Olle Linge PAVC decks. See [vocabulary provenance](public/data/README.md).

Scheduling uses a TypeScript port of the app-relevant **Anki 26.09.4** scheduler, pinned to [commit `c06370f`](https://github.com/ankitects/anki/tree/c06370ff4d87cb48d825f90cc83e02b9a4e84ecd/rslib/src/scheduler). It combines FSRS-6 memory updates with Anki's learning steps, interval rounding and fuzz, relearning, day boundaries, and queue ordering. The FSRS math is translated from the `fsrs` Rust crate 6.6.2 used by that Anki release. The four review buttons rate recall of the word’s meaning; drawing does not change that rating.

The configuration is 90% desired retention, learning steps of 1 and 10 minutes, a 1-minute relearning step, a 36,500-day maximum interval, and enabled interval fuzz. Due learning comes first; due reviews and interday learning come before new words in textbook order. When that queue is empty, learning cards due within 20 minutes can appear early, as with Anki's learn-ahead setting. This ports the scheduling path used by this app, not all of Anki: there are no filtered decks, sibling burying, FSRS parameter optimization, load balancing, or SM-2 mode.

The default allowance is **10 new words per day across all three books**. Settings beside the home refresh icon adjusts this from 0 to 999 and syncs it with your account. A word consumes one slot when first rated; repeat learning/review answers do not consume another slot. Existing first-review history counts toward today’s allowance. It resets at **4am in the device's local timezone**, matching Anki's default study-day boundary, without carrying unused slots forward. Blue counts show the available new words today, while progress bars still measure all words started. Due reviews remain available after the new-word limit is reached.

Handwriting practice shows a whole word on one continuous surface: two or three characters side by side, with longer phrases wrapping. Stroke guides animate through the word and repeat. Tap to flip, drag to draw; undo and clear affect the whole drawing. Text selection and touch callouts are disabled during study.

Card states and review history are stored in **InstantDB**, linked to your signed-in account. Reloading restores your progress and next review dates. Rating a card saves its updated FSRS state and review log together before moving on; if saving fails, the revealed card stays available to retry. Offline writes use InstantDB’s local queue and the app shows “Waiting to sync” while confirmation is pending. Sign out and a refresh icon are available on the books page. Source notes and licenses are included with the vocabulary, stroke data, and audio files.

Existing progress is retained: the scheduler does not reset or reschedule saved cards on load. A card gains the new scheduler metadata when it is next rated. Existing timestamps remain in effect until then. Numeric card IDs use Anki's seed convention for fuzz; this app's string vocabulary IDs receive a stable numeric seed.

## Scheduler verification

`npm test` compares the TypeScript implementation with fixtures generated by the unmodified official Anki 26.09.4 Python package, which calls Anki's Rust core. Fixtures include new, learning, review and relearning transitions, production fuzz, queue selection and learning requeue sequences. Floating-point memory values use a small tolerance for Rust/JavaScript math differences; integer scheduling outcomes are compared exactly. This verifies the covered cases, not every Anki feature or possible input.

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

The application license does **not** grant rights to the vocabulary, generated audio, or third-party stroke data. Their provenance and applicable terms remain in their respective directories. In particular, no redistribution license for the source vocabulary lists has been established. This is an independent project, not an official Anki application. Complete application source and build instructions are available in [this public repository](https://github.com/stopachka/stopa-Anki); the app's source icon links here.
