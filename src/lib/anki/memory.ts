// Copyright: Ankitects Pty Ltd and contributors.
// TypeScript adaptation: stopa-Anki contributors, 2026.
// SPDX-License-Identifier: AGPL-3.0-or-later
// Ported from Anki 26.09.4 rslib/src/storage/card/data.rs:
// https://github.com/ankitects/anki/blob/26.09.4/rslib/src/storage/card/data.rs
import type { FsrsMemory } from './fsrs.ts';

function roundToPlaces(value: number, places: number): number {
  const factor = Math.fround(10 ** places);
  const scaled = Math.fround(Math.fround(value) * factor);
  // Rust f32::round uses ties away from zero, unlike Math.round for negatives.
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return Math.fround(rounded / factor);
}

/** Match the memory state reloaded after Anki writes its card data column. */
export function persistMemoryState(memory: FsrsMemory): FsrsMemory {
  return {
    stability: roundToPlaces(memory.stability, 4),
    difficulty: roundToPlaces(memory.difficulty, 3),
  };
}
