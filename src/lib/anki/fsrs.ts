/*!
 * FSRS-6 scalar inference, translated from fsrs-rs 6.6.2 src/model.rs and
 * src/inference.rs, the version used by Anki 26.09.4.
 * Source: https://crates.io/crates/fsrs/6.6.2
 *
 * BSD 3-Clause License
 * Copyright (c) 2023, Open Spaced Repetition
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software
 *    without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

export type FsrsMemory = { stability: number; difficulty: number };
export type FsrsNextState = { memory: FsrsMemory; interval: number };
export type FsrsNextStates = Record<'again' | 'hard' | 'good' | 'easy', FsrsNextState>;

// Rust's inference model stores parameters and intermediate results as f32.
// Math.* is evaluated in JS double precision, then rounded back to f32 at the
// same operation boundaries. Transcendental functions may differ by a few ULPs
// across runtimes; parity tests use tight relative tolerances for memory values.
const f = Math.fround;
const add = (a: number, b: number) => f(a + b);
const sub = (a: number, b: number) => f(a - b);
const mul = (a: number, b: number) => f(a * b);
const div = (a: number, b: number) => f(a / b);
const exp = (a: number) => f(Math.exp(a));
const pow = (a: number, b: number) => f(Math.pow(a, b));
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const S_MIN = f(0.001);
const S_MAX = 36_500;

export const FSRS6_DEFAULT_PARAMETERS: readonly number[] = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194,
  0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629,
  1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
].map(f));
const w = FSRS6_DEFAULT_PARAMETERS;
const decay = -w[20];
const factor = sub(exp(div(f(Math.log(f(0.9))), decay)), 1);

function initialDifficulty(rating: number): number {
  return add(sub(w[4], exp(mul(w[5], rating - 1))), 1);
}

function nextInterval(stability: number, retention: number): number {
  return mul(div(stability, factor), sub(pow(retention, div(1, decay)), 1));
}

function nextMemory(memory: FsrsMemory | null, elapsedDays: number, rating: number): FsrsMemory {
  if (!memory) return { stability: w[rating - 1], difficulty: clamp(initialDifficulty(rating), 1, 10) };

  const stability = clamp(f(memory.stability), S_MIN, S_MAX);
  const difficulty = clamp(f(memory.difficulty), 1, 10);
  const retrievability = pow(add(mul(div(elapsedDays, stability), factor), 1), decay);
  let nextStability: number;

  if (elapsedDays === 0) {
    const increase = mul(exp(mul(w[17], add(rating - 3, w[18]))), pow(stability, -w[19]));
    nextStability = mul(stability, rating >= 2 ? Math.max(increase, 1) : increase);
  } else if (rating === 1) {
    const failure = mul(mul(mul(w[11], pow(difficulty, -w[12])), sub(pow(add(stability, 1), w[13]), 1)), exp(mul(sub(1, retrievability), w[14])));
    const maximum = div(stability, exp(mul(w[17], w[18])));
    nextStability = Math.min(failure, maximum);
  } else {
    const hardPenalty = rating === 2 ? w[15] : 1;
    const easyBonus = rating === 4 ? w[16] : 1;
    const increase = mul(mul(mul(mul(mul(exp(w[8]), sub(11, difficulty)), pow(stability, -w[9])), sub(exp(mul(sub(1, retrievability), w[10])), 1)), hardPenalty), easyBonus);
    nextStability = mul(stability, add(increase, 1));
  }

  const deltaDifficulty = mul(-w[6], rating - 3);
  const dampedDifficulty = add(difficulty, div(mul(sub(10, difficulty), deltaDifficulty), 9));
  const nextDifficulty = add(mul(w[7], sub(initialDifficulty(4), dampedDifficulty)), dampedDifficulty);
  return { stability: clamp(nextStability, S_MIN, S_MAX), difficulty: clamp(nextDifficulty, 1, 10) };
}

/** Raw FSRS-6 next states. Anki's learning, rounding, fuzz, and queue rules sit above this. */
export function nextMemoryStates(memory: FsrsMemory | null, elapsedDays: number, desiredRetention = 0.9): FsrsNextStates {
  if (!Number.isInteger(elapsedDays) || elapsedDays < 0 || elapsedDays > 0xffff_ffff) throw new Error('Elapsed days must be a nonnegative integer.');
  if (!Number.isFinite(desiredRetention) || desiredRetention <= 0 || desiredRetention >= 1) throw new Error('Retention must be between zero and one.');
  if (memory && (!Number.isFinite(memory.stability) || !Number.isFinite(memory.difficulty))) throw new Error('Invalid memory state.');
  const elapsed = f(elapsedDays);
  const retention = f(desiredRetention);
  const output = (rating: number): FsrsNextState => {
    const next = nextMemory(memory, elapsed, rating);
    return { memory: next, interval: nextInterval(next.stability, retention) };
  };
  return { again: output(1), hard: output(2), good: output(3), easy: output(4) };
}
