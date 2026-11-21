# RWKV Big SM99 — browser inference

This directory contains the **Big Instant-Only SM99** pretrained model from
[JSchoreels/anki-rwkv, release `rwkv-family-2026-11-13`](https://github.com/JSchoreels/anki-rwkv/releases/tag/rwkv-family-2026-11-13).
The model has 2,762,884 parameters and consumes 92 numerical review-history features.
It does not consume the vocabulary text or handwriting.

## Pinned assets

- `big-sm99-682ba1ff.weights.bin`: the release's unmodified `weights.f32.bin`,
  11,082,637 bytes; SHA-256
  `682ba1ff207c51af7de5e2abeb25593362aa706b292cbcc338a1591fad0d935c`.
- `architecture.json`: the release's architecture specification; line endings normalized.
- `runtime-v1.wasm`: Stopa Anki's Rust/WebAssembly SIMD port. Its current SHA-256
  and the weight hash are generated into `src/lib/rwkv/runtime-assets.json`.
- `WEIGHTS-NOTICE.md`: upstream's separate pretrained-weight terms, unchanged.
- `REFERENCE-LICENSE.txt`: the MIT notice for Jonathan Schoreels' reference code.

The source package is `rwkv-big-instant-only.zip` in the release above. Its
`reference/small_model_recurrent.py` supplies the inference equations; its synthetic
`testvectors/user_900001.npz` and `user_900002.npz` supply independent golden cases.
The research checkout used during implementation was commit
`0db609c9cfd1438f50ab8a1e089f455dc9918478`; binary release identity is pinned separately
by the weight checksum, not inferred from that checkout.

## What runs

The browser worker loads the full published FP32 weight file and evaluates its
instant head. It uses all five recurrent scopes: card, deck, note, preset, and
user. Query steps compute predictions without committing recurrent state; answer
steps commit state. The untrained curve head is never used. Existing FSRS due dates
can still be maintained by the surrounding scheduler; these are not SM99 curves.

Production uses **FP32 weights, arithmetic, and state**. State is allocated only
for entities with committed reviews. The smaller compressed-memory estimates in
the upstream documentation do not describe this production configuration. There
are 87,040 bytes of FP32 recurrent values per studied card/note pair, plus shared
scopes and allocator overhead. At all 1,787 cards studied, raw recurrent values
therefore occupy approximately 156 MB. The worker's measured WebAssembly heap and
timings depend on the browser and device.

An internal `stateBits: 8` option implements compact card/note state for experiments.
It is not selected by the app. Quantization thresholds amplify tiny floating-point
differences, so it does not satisfy the same strict golden tolerance as FP32.

## Build and verification

The compiled module is checked in, so the normal Vite build does not need Rust.
To change the engine, install the `wasm32-unknown-unknown` Rust target, then run:

```sh
node scripts/rwkv/build.mjs
node --experimental-strip-types --test src/lib/rwkv/runtime.test.ts
```

The build uses Rust 2021, `-C opt-level=3 -C target-feature=+simd128`, and no crates,
WASI imports, browser GPU, network APIs, or threads. It sets a 512 MiB maximum
WebAssembly memory. The engine and TypeScript wrapper are under the application's
AGPL-3.0-or-later license, with reference attribution retained above.

The model weights are **not covered by the application license or the reference
code's MIT license**. See the unmodified upstream `WEIGHTS-NOTICE.md` for their
provenance and unresolved distribution terms.
