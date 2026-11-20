import test from 'node:test';
import assert from 'node:assert/strict';
import { persistMemoryState } from './memory.ts';

test('persisted memory matches Anki card-data compact_floats test', () => {
  assert.deepEqual(persistMemoryState({ stability: 123.45678, difficulty: 1.234567 }), {
    stability: Math.fround(123.4568), difficulty: Math.fround(1.235),
  });
});

test('a fresh Again memory retains four stability and three difficulty places', () => {
  const memory = Object.freeze({ stability: Math.fround(0.212), difficulty: Math.fround(6.4133) });
  assert.deepEqual(persistMemoryState(memory), {
    stability: Math.fround(0.212), difficulty: Math.fround(6.413),
  });
});

test('persistence rounds ties using f32 multiplication before rounding', () => {
  // Verified against the native Rust round_to_places implementation: 1.00015
  // rounds up, while f32's representation of 1.00005 falls below that tie.
  assert.deepEqual(persistMemoryState({ stability: 1.00015, difficulty: 1.2345 }), {
    stability: Math.fround(1.0002), difficulty: Math.fround(1.235),
  });
  assert.deepEqual(persistMemoryState({ stability: -1.00015, difficulty: -1.2345 }), {
    stability: Math.fround(-1.0002), difficulty: Math.fround(-1.235),
  });
  assert.equal(persistMemoryState({ stability: 1.00005, difficulty: 1 }).stability, 1);
});

test('persisted model bounds and already-rounded memory remain stable', () => {
  for (const memory of [
    { stability: 0.001, difficulty: 1 },
    { stability: 36_500, difficulty: 10 },
    { stability: 2.3065, difficulty: 2.118 },
  ]) {
    const stored = persistMemoryState(memory);
    assert.deepEqual(stored, { stability: Math.fround(memory.stability), difficulty: Math.fround(memory.difficulty) });
    assert.deepEqual(persistMemoryState(stored), stored);
  }
});
