// Copyright: Ankitects Pty Ltd and contributors.
// TypeScript port of Anki 26.09.4 rslib/src/scheduler/states/fuzz.rs.
// SPDX-License-Identifier: AGPL-3.0-or-later

const f32 = Math.fround;
const U32_MAX = 0xffff_ffff;
const u32 = (value: number) => Number.isNaN(value) ? 0 : Math.max(0, Math.min(U32_MAX, Math.trunc(value)));
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

/** The interval itself is f32 in Anki's state machine. */
export function fuzzBounds(value: number): [number, number] {
  const interval = f32(value);
  let delta = 0;
  if (interval >= 2.5) {
    delta = 1;
    for (const [start, end, factor] of [[2.5, 7, 0.15], [7, 20, 0.1], [20, Infinity, 0.05]]) {
      const length = Math.max(0, f32(Math.min(interval, end) - start));
      delta = f32(delta + f32(f32(factor) * length));
    }
  }
  return [u32(Math.round(f32(interval - delta))), u32(Math.round(f32(interval + delta)))];
}

export function constrainedFuzzBounds(value: number, minimum: number, maximum: number): [number, number] {
  minimum = Math.min(minimum, maximum);
  const interval = clamp(f32(value), f32(minimum), f32(maximum));
  let [lower, upper] = fuzzBounds(interval);
  lower = clamp(lower, minimum, maximum);
  upper = clamp(upper, minimum, maximum);
  if (upper === lower && upper > 2 && upper < maximum) upper = lower + 1;
  return [lower, upper];
}

/** Pass null to obtain Anki's deterministic test-mode behavior. */
export function withReviewFuzz(interval: number, minimum: number, maximum: number, fuzzFactor: number | null): number {
  minimum = Math.min(minimum, maximum);
  if (fuzzFactor === null) return clamp(u32(Math.round(f32(interval))), minimum, maximum);
  const [lower, upper] = constrainedFuzzBounds(interval, minimum, maximum);
  return u32(Math.floor(f32(f32(lower) + f32(f32(fuzzFactor) * f32(1 + upper - lower)))));
}

export function minimumReviewFuzzInterval(interval: number, previousInterval: number, maximumInterval: number): number {
  const rounded = u32(Math.round(f32(interval)));
  const [, upper] = constrainedFuzzBounds(interval, 1, maximumInterval);
  if (rounded > previousInterval) return previousInterval + 1;
  return previousInterval <= upper ? previousInterval : 0;
}

/*
 * RNG compatibility code below is adapted from rand_core 0.9 / rand_chacha 0.9 /
 * rand 0.9.4 (the versions used by Anki 26.09.4).
 * Copyright 2018 Developers of the Rand project
 * Copyright (c) 2014 The Rust Project Developers
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

const U64_MASK = (1n << 64n) - 1n;
const rotateLeft = (value: number, bits: number) => ((value << bits) | (value >>> (32 - bits))) >>> 0;

/** Only the first block is needed: Anki restarts StdRng for each fuzz operation. */
function stdRngFirstBlock(seed: bigint): number[] {
  let state = seed & U64_MASK;
  const key: number[] = [];
  for (let i = 0; i < 8; i++) {
    state = (state * 6364136223846793005n + 11634580027462260723n) & U64_MASK;
    const word = Number((((state >> 18n) ^ state) >> 27n) & 0xffff_ffffn);
    const rotation = Number(state >> 59n);
    key.push(((word >>> rotation) | (word << ((32 - rotation) & 31))) >>> 0);
  }
  const initial = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574, ...key, 0, 0, 0, 0];
  const words = [...initial];
  const quarterRound = (a: number, b: number, c: number, d: number) => {
    words[a] = (words[a] + words[b]) >>> 0;
    words[d] = rotateLeft(words[d] ^ words[a], 16);
    words[c] = (words[c] + words[d]) >>> 0;
    words[b] = rotateLeft(words[b] ^ words[c], 12);
    words[a] = (words[a] + words[b]) >>> 0;
    words[d] = rotateLeft(words[d] ^ words[a], 8);
    words[c] = (words[c] + words[d]) >>> 0;
    words[b] = rotateLeft(words[b] ^ words[c], 7);
  };
  for (let round = 0; round < 6; round++) {
    quarterRound(0, 4, 8, 12); quarterRound(1, 5, 9, 13);
    quarterRound(2, 6, 10, 14); quarterRound(3, 7, 11, 15);
    quarterRound(0, 5, 10, 15); quarterRound(1, 6, 11, 12);
    quarterRound(2, 7, 8, 13); quarterRound(3, 4, 9, 14);
  }
  return words.map((word, index) => (word + initial[index]) >>> 0);
}

/** Matches StdRng::seed_from_u64(seed).random_range(0.0f32..1.0). */
export function getFuzzFactor(seed: bigint): number {
  return (stdRngFirstBlock(seed)[0] >>> 9) / 8_388_608;
}

/** Anki adds up to 25% (capped at five minutes) to the actual intraday due time. */
export function learningIntervalWithFuzz(seconds: number, seed: bigint | null): number {
  if (seed === null) return seconds;
  const upperExclusive = seconds + Math.floor(Math.min(300, f32(f32(seconds) * 0.25)));
  if (seconds >= upperExclusive) return seconds;
  const words = stdRngFirstBlock(seed);
  const range = BigInt(upperExclusive - seconds);
  const product = BigInt(words[0]) * range;
  let result = Number(product >> 32n);
  const low = Number(product & 0xffff_ffffn);
  // rand's default Canon sampling path (the "unbiased" feature is not enabled).
  if (low > Number((1n << 32n) - range)) {
    const nextHigh = Number((BigInt(words[1]) * range) >> 32n);
    if (low + nextHigh > U32_MAX) result++;
  }
  return seconds + result;
}
