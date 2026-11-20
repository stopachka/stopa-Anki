# Generated Mandarin pronunciation

Audio in this directory is AI-generated with OpenAI; it is not a recording of a human speaker. The generator requests Taiwanese Mandarin and supplies each card's existing pinyin and English gloss as pronunciation context. This is a pronunciation request, not a guarantee of perfect accents or polyphonic character readings; listen to samples before generating the full set.

`manifest.json` maps the exact key `traditional|pinyin` to a local MP3 URL and generation metadata. Repeated vocabulary uses the same recording. The current audio scope is **Book 1 only**: its 292 cards need 287 unique recordings. Books 2 and 3 are not part of this generation batch.

To generate a small sample, supply `OPENAI_API_KEY` in the shell environment and run from the app directory:

```sh
node scripts/generate-audio.mjs --book 1 --limit 5
```

Generate the remaining Book 1 vocabulary with `node scripts/generate-audio.mjs --book 1`. Inspect progress without credentials or API calls with `node scripts/generate-audio.mjs --dry-run --book 1`. Keep `--book 1` on generation commands to preserve the current scope.

The script resumes after each success, retries transient errors, and stops on authentication, billing, or model-access errors. Existing manifest entries and audio are preserved. Recordings marked `qualityChecked` are reused by normal runs even when a repair used a different voice or generation recipe. Explicit `--voice` or `--model` options request that matching setting and can generate replacements. The API key stays in the generator's process environment and must never use a `VITE_` prefix or enter client code.

## Book 1 audio review

All 287 unique Book 1 recordings were transcribed for an automated content check. The first generation included repetition, extra speech, and two silent files. Those 109 flagged recordings were repaired using a Mandarin context phrase followed by the target vocabulary, extracting the vocabulary after the pause, or extracting one complete occurrence from a repeated recording. Every replacement was transcribed again. The remaining 178 recordings had their leading/trailing silence trimmed, retaining 100 ms padding. A final waveform review identified 12 long clips with residual audio after the word; their complete first utterance was extracted and transcribed again.

The final manifest records the actual voice (`marin` or `coral`), trim boundaries, generation recipe, and automated review details. ASR accepts matching Chinese words or same-syllable homophones; it does not establish exact tones or Taiwan accent. In particular, isolated `呢` is ambiguous to ASR: it recognized `呢` in its natural phrase, while the isolated extracted syllable is transcribed as `那`. This particle needs a native listener's confirmation; the limitation is retained in its manifest entry.

Default model: `gpt-4o-mini-tts-2025-12-15`. Default voice: `marin`. Official documentation checked on November 19, 2026 supports Chinese and recommends `marin` or `cedar` for quality. This Speech API model is deprecated and scheduled to shut down on January 6, 2027. Existing generated MP3s will remain usable; generation after shutdown will require migration to the Realtime API.

References:

- [OpenAI text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech)
- [Speech endpoint](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)
- [Model and pricing](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts)
