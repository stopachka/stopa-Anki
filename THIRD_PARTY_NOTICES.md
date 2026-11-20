# Licenses and source attribution

Application code in stopa-Anki is distributed under the GNU Affero General Public License, version 3 or later, except for components with the separate notices below. Copyright 2026 stopa-Anki contributors. The full AGPL text is in [LICENSE](LICENSE) and is also served with the app at [`/licenses/AGPL-3.0.txt`](https://stopa-anki.vercel.app/licenses/AGPL-3.0.txt).

Complete application source, dependency versions and build instructions are available without charge at [github.com/stopachka/stopa-Anki](https://github.com/stopachka/stopa-Anki). This project is independent of Anki and does not claim endorsement by its authors.

## Anki scheduler

- Source: [Anki 26.09.4](https://github.com/ankitects/anki/tree/c06370ff4d87cb48d825f90cc83e02b9a4e84ecd), commit `c06370ff4d87cb48d825f90cc83e02b9a4e84ecd`.
- Copyright: Ankitects Pty Ltd and contributors.
- License: GNU AGPL version 3 or later; some upstream contributions are BSD-3-Clause, as described in the [upstream license](public/licenses/anki-LICENSE.txt) and [contributors file](https://github.com/ankitects/anki/blob/c06370ff4d87cb48d825f90cc83e02b9a4e84ecd/CONTRIBUTORS).
- Modified: relevant Rust scheduler state transitions, learning-step rules, interval fuzz, queue ordering and timing were translated to TypeScript in `src/lib/anki/` in November 2026. Storage and integration use this app's card model and InstantDB. This is a subset for ordinary FSRS study, not a distribution of Anki's complete backend. Original Rust file paths are identified in the source headers.

The unmodified official Anki Python package is used only to generate test fixtures; it is not shipped in the browser application.

## FSRS scalar inference

- Source: [`fsrs` 6.6.2](https://crates.io/crates/fsrs/6.6.2), `src/model.rs` and `src/inference.rs`, maintained by [Open Spaced Repetition](https://github.com/open-spaced-repetition/fsrs-rs).
- Copyright (c) 2023, Open Spaced Repetition.
- License: [BSD 3-Clause](public/licenses/fsrs-BSD-3-Clause.txt).
- Modified: scalar FSRS-6 inference was translated to TypeScript in `src/lib/anki/fsrs.ts` in November 2026, with explicit float32 arithmetic boundaries and the default FSRS-6 parameter vector. Training and optimization are not included. The original BSD notice is retained in the source file and distributed license copy.

## Rand compatibility code

- Source: [`rand` 0.9.4](https://crates.io/crates/rand/0.9.4), `rand_core` 0.9 and `rand_chacha` 0.9, maintained by the [Rand project](https://github.com/rust-random/rand).
- Copyright 2018 Developers of the Rand project; Copyright (c) 2014 The Rust Project Developers.
- License selected for this adaptation: [MIT](public/licenses/rand-MIT.txt).
- Modified: seed expansion, the first ChaCha12 output block, and sampling needed for Anki's interval fuzz were translated to TypeScript in `src/lib/anki/fuzz.ts` in November 2026. This is scheduling compatibility code, not a general-purpose cryptographic random-number API. The MIT notice is retained in the source and distributed license copy.

## Other bundled libraries

Dependencies retain their own licenses; the dependency lockfile records exact versions. Distributed license copies cover the following runtime dependencies:

- [Hanzi Writer (MIT)](public/licenses/hanzi-writer-MIT.txt).
- [React, React DOM and React Scheduler (MIT)](public/licenses/react-MIT.txt).
- [Lucide (ISC, with Feather-derived portions)](public/licenses/lucide-ISC.txt).
- [InstantDB's React, core, react-common and version packages (Apache 2.0)](public/licenses/Apache-2.0.txt), from [instantdb/instant](https://github.com/instantdb/instant/tree/main/client/packages).
- [Mutative (MIT)](public/licenses/mutative-MIT.txt), [UUID (MIT)](public/licenses/uuid-MIT.txt), [EventSource (MIT)](public/licenses/eventsource-MIT.txt), and [EventSource Parser (MIT)](public/licenses/eventsource-parser-MIT.txt).

These notices do not replace each package's own license files.

## Data and audio are separate

The application license does not relicense assets or grant rights that their sources did not grant:

- `public/data/`: Olle Linge's archived Practical Audio-Visual Chinese vocabulary lists, with local corrections. No open-source or redistribution license has been established for these lists. See [vocabulary provenance](public/data/README.md).
- `public/hanzi/`: Hanzi Writer data / Make Me a Hanzi and the identified AnimCJK character, under the Arphic Public License. Existing [Arphic license](public/hanzi/ARPHICPL.TXT), [AnimCJK notice](public/hanzi/ANIMCJK-COPYING.txt), and [provenance](public/hanzi/README.md) remain in that directory.
- `public/audio-openai/`: generated pronunciation audio and its manifest are not covered by the application-code AGPL grant. See [generation provenance](public/audio-openai/README.md). No new license for these recordings is asserted here.
