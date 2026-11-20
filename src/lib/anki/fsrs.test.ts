import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextMemoryStates } from './fsrs.ts';

const names = ['again', 'hard', 'good', 'easy'] as const;
function close(actual: number, expected: number): void {
  // Native libm and browser transcendental functions can differ by a few f32 ULPs.
  assert.ok(Math.abs(actual - expected) <= Math.max(1e-7, Math.abs(expected) * 2e-6), `${actual} != ${expected}`);
}

test('fresh-card memory states match the official FSRS6 inference example', () => {
  const states = nextMemoryStates(null, 0);
  const expected = [[0.212, 6.4133], [1.2931, 5.1121707], [2.3065, 2.118104], [8.2956, 1]];
  names.forEach((name, index) => {
    close(states[name].memory.stability, expected[index][0]);
    close(states[name].memory.difficulty, expected[index][1]);
    close(states[name].interval, expected[index][0]);
  });
});

// Generated independently by compiling the unmodified scalar functions from
// fsrs-rs6.6.2 model.rs, with MemoryState { stability:10.0, difficulty:5.0 }.
// Each row is [elapsed days, retention, four stabilities, four raw intervals].
const rustCases: [number, number, number[], number[]][] = [
  [0, 0.9, [3.051248789, 10, 10, 15.534309387], [3.051248789, 10, 10, 15.534309387]],
  [0, 0.95, [3.051248789, 10, 10, 15.534309387], [1.228306651, 4.025587082, 4.025587082, 6.253471375]],
  [1, 0.9, [1.208647370, 11.832569122, 13.047170639, 15.707045555], [1.208647370, 11.832569122, 13.047170639, 15.707044601]],
  [1, 0.95, [1.208647370, 11.832569122, 13.047170639, 15.707045555], [0.486551493, 4.763303280, 5.252252102, 6.323007107]],
  [10, 0.9, [1.391986966, 23.246887207, 32.026748657, 51.253894806], [1.391986966, 23.246887207, 32.026748657, 51.253894806]],
  [10, 0.95, [1.391986966, 23.246887207, 32.026748657, 51.253894806], [0.560356438, 9.358236313, 12.892646790, 20.632699966]],
  [365, 0.9, [2.384061337, 74.619911194, 117.449127197, 211.241470337], [2.384061337, 74.619911194, 117.449127197, 211.241470337]],
  [365, 0.95, [2.384061337, 74.619911194, 117.449127197, 211.241470337], [0.959724545, 30.038892746, 47.280166626, 85.037094116]],
];
for (const [days, retention, stabilities, intervals] of rustCases) {
  test(`memory updates match native Rust at ${days} days and ${retention} retention`, () => {
    const input = Object.freeze({ stability: 10, difficulty: 5 });
    const states = nextMemoryStates(input, days, retention);
    const difficulties = [8.341762543, 6.665995598, 4.990228176, 3.314461470];
    names.forEach((name, index) => {
      close(states[name].memory.stability, stabilities[index]);
      close(states[name].memory.difficulty, difficulties[index]);
      close(states[name].interval, intervals[index]);
    });
  });
}

test('existing memory values are clamped using the model bounds', () => {
  for (const input of [{ stability: 0, difficulty: -5 }, { stability: 1e9, difficulty: 50 }]) {
    for (const state of Object.values(nextMemoryStates(input, 365))) {
      assert.ok(state.memory.stability >= Math.fround(0.001) && state.memory.stability <= 36_500);
      assert.ok(state.memory.difficulty >= 1 && state.memory.difficulty <= 10);
      assert.ok(Number.isFinite(state.interval) && state.interval > 0);
    }
  }
});

test('invalid input cannot produce a saved invalid memory state', () => {
  for (const days of [-1, 0.5, Infinity, NaN]) assert.throws(() => nextMemoryStates(null, days));
  for (const retention of [0, 1, -0.1, NaN]) assert.throws(() => nextMemoryStates(null, 0, retention));
  assert.throws(() => nextMemoryStates({ stability: NaN, difficulty: 5 }, 1));
  assert.throws(() => nextMemoryStates({ stability: 2, difficulty: Infinity }, 1));
});

test('memory transitions also match the installed official Anki core', () => {
  const fixture = JSON.parse(readFileSync(new URL('../__fixtures__/anki-reference.json', import.meta.url), 'utf8')) as {
    cases: {
      name: string;
      card: { stability: number; difficulty: number };
      elapsedFsrsDays: number;
      options: { desiredRetention: number };
      expected: Record<string, { stability: number; difficulty: number }>;
    }[];
  };
  const cases = fixture.cases.filter(value => value.name.startsWith('memory-s10-d5-'));
  assert.equal(cases.length, 8);
  for (const value of cases) {
    const states = nextMemoryStates(value.card, value.elapsedFsrsDays, value.options.desiredRetention);
    names.forEach((name, index) => {
      close(states[name].memory.stability, value.expected[String(index + 1)].stability);
      close(states[name].memory.difficulty, value.expected[String(index + 1)].difficulty);
    });
  }
});
