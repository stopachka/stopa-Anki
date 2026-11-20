// Copyright: Ankitects Pty Ltd and contributors.
// TypeScript port of Anki 26.09.4 rslib/src/scheduler/states/steps.rs.
// SPDX-License-Identifier: AGPL-3.0-or-later

const DAY = 86_400;
const U32_MAX = 0xffff_ffff;
const u32 = (value: number) => Number.isNaN(value) ? 0 : Math.max(0, Math.min(U32_MAX, Math.trunc(value)));
const saturatingAdd = (a: number, b: number) => Math.min(U32_MAX, a + b);
const saturatingMultiply = (a: number, b: number) => Math.min(U32_MAX, a * b);

/** Anki stores learning steps as minutes, using f32 arithmetic before truncating seconds. */
export class LearningSteps {
  private readonly steps: readonly number[];

  constructor(minutes: readonly number[]) {
    this.steps = minutes.map(Math.fround);
  }

  private index(remaining: number): number {
    const total = this.steps.length;
    return Math.min(Math.max(0, total - (u32(remaining) % 1000)), Math.max(0, total - 1));
  }

  private secondsAt(index: number): number | undefined {
    const minutes = this.steps[index];
    return minutes === undefined ? undefined : u32(Math.fround(minutes * 60));
  }

  againDelaySeconds(): number | undefined {
    return this.secondsAt(0);
  }

  hardDelaySeconds(remaining: number): number | undefined {
    const index = this.index(remaining);
    const current = this.secondsAt(index) ?? this.secondsAt(0);
    if (current === undefined || index !== 0) return current;
    const next = this.secondsAt(1);
    const seconds = next === undefined
      ? Math.min(Math.trunc(saturatingMultiply(current, 3) / 2), saturatingAdd(current, DAY))
      : Math.trunc(saturatingAdd(current, next) / 2);
    return seconds > DAY
      ? saturatingMultiply(u32(Math.round(Math.fround(Math.fround(seconds) / DAY))), DAY)
      : seconds;
  }

  goodDelaySeconds(remaining: number): number | undefined {
    return this.secondsAt(this.index(remaining) + 1);
  }

  currentDelaySeconds(remaining: number): number {
    return this.secondsAt(this.index(remaining)) ?? 0;
  }

  remainingForGood(remaining: number): number {
    return Math.max(0, this.steps.length - (this.index(remaining) + 1));
  }

  remainingForFailed(): number {
    return this.steps.length;
  }

  isEmpty(): boolean {
    return this.steps.length === 0;
  }
}
