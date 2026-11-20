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

Scheduling uses `ts-fsrs` 6.0.0, explicitly configured for **FSRS-6**, the same algorithm family used by Anki. It targets 90% retention, prioritizes due reviews, and introduces new words in textbook order. The four review buttons rate recall of the word’s meaning; drawing does not change that rating.

Card states and review history are stored in **InstantDB**, linked to your signed-in account. Reloading restores your progress and next review dates. Rating a card saves its updated FSRS state and review log together before moving on; if saving fails, the revealed card stays available to retry. Offline writes use InstantDB’s local queue and the app shows “Waiting to sync” while confirmation is pending. Sign out and a refresh icon are available on the books page. Source notes and licenses are included with the vocabulary, stroke data, and audio files.

## Pronunciation audio

The speaker icon plays local, pre-generated OpenAI audio from `public/audio-openai/`, indexed by the exact `traditional|pinyin` pair. The current generation scope is **Book 1 only**: 287 unique recordings cover its 292 cards. Books 2 and 3 do not yet have generated audio. These are AI-generated pronunciations, not human recordings; pronunciation quality, tones, and alternate readings still need listening review.

The browser only reads the saved MP3s and manifest. It never receives an API key or calls the generation API. To generate or resume Book 1 audio, provide `OPENAI_API_KEY` in the generator’s shell environment, then run:

```sh
node scripts/generate-audio.mjs --book 1 --concurrency 8
```

Keep `--book 1` to limit the generation scope. Use `--limit 5` for a sample, or `--dry-run --book 1` to inspect coverage without API calls. Never put the key in frontend code, a committed file, or a `VITE_` environment variable. See the [audio README](public/audio-openai/README.md) for generation details and model lifecycle notes.

## Stroke guides

Hanzi Writer loads bundled character data from `public/hanzi/`, without a runtime CDN request. All 1,043 unique Han characters in the decks have stroke data. Traditional-character coverage does not guarantee that every glyph or stroke order matches Taiwan’s standards. See the [stroke data README and licenses](public/hanzi/README.md).
