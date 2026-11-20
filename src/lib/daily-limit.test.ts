import test from 'node:test';
import assert from 'node:assert/strict';
import { State } from './anki/types.ts';
import { DEFAULT_DAILY_NEW_LIMIT, dayBounds, introducedWordIds, normalizeDailyNewLimit, remainingNewWords, type DailyReview } from './daily-limit.ts';

test('daily new-word settings default to ten and accept integer limits including zero', () => {
  assert.equal(DEFAULT_DAILY_NEW_LIMIT, 10);
  for (const value of [undefined, null, '20', -1, 1.5, 1000, NaN, Infinity]) {
    assert.equal(normalizeDailyNewLimit(value), 10);
  }
  for (const value of [0, 1, 10, 25, 999]) assert.equal(normalizeDailyNewLimit(value), value);
});

test('introductions count unique words across books, not learning repeats or duplicate saves', () => {
  const now = new Date(2026, 10, 19, 12);
  const at = now.getTime();
  const reviews: DailyReview[] = [
    { wordId: 'book1-word', reviewedAt: at, log: { state: State.New } },
    { wordId: 'book1-word', reviewedAt: at + 1, log: { state: State.New } },
    { wordId: 'book1-word', reviewedAt: at + 60_000, log: { state: State.Learning } },
    { wordId: 'book2-word', reviewedAt: at, log: { state: State.New } },
    { wordId: 'old-word', reviewedAt: at, log: { state: State.Review } },
    { wordId: 'forgotten-word', reviewedAt: at, log: { state: State.Relearning } },
  ];
  const introductions = introducedWordIds(reviews, now);
  assert.deepEqual([...introductions], ['book1-word', 'book2-word']);
  assert.equal(remainingNewWords(10, introductions), 8);
  assert.equal(remainingNewWords(1, introductions), 0);
  assert.equal(remainingNewWords(0, []), 0);
  assert.equal(remainingNewWords(10, ['same', 'same']), 9);
});

test('the daily allowance resets at 4am without carrying unused allowance forward', () => {
  const now = new Date(2026, 10, 19, 12);
  const { start, end } = dayBounds(now);
  const reviews: DailyReview[] = [
    { wordId: 'yesterday', reviewedAt: start - 1, log: { state: State.New } },
    { wordId: 'rollover', reviewedAt: start, log: { state: State.New } },
    { wordId: 'late', reviewedAt: end - 1, log: { state: State.New } },
    { wordId: 'tomorrow', reviewedAt: end, log: { state: State.New } },
  ];
  assert.deepEqual([...introducedWordIds(reviews, now)], ['rollover', 'late']);
  assert.equal(new Date(start).getHours(), 4);
  assert.equal(remainingNewWords(10, introducedWordIds(reviews, new Date(end))), 9);
  assert.equal(remainingNewWords(10, introducedWordIds(reviews, new Date(2026, 10, 21, 12))), 10);
});

test('local day bounds handle both daylight-saving transitions', () => {
  const previousTZ = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const spring = dayBounds(new Date(2026, 2, 7, 12));
    const autumn = dayBounds(new Date(2026, 9, 31, 12));
    assert.equal((spring.end - spring.start) / 3_600_000, 23);
    assert.equal((autumn.end - autumn.start) / 3_600_000, 25);
    assert.equal(new Date(spring.start).getHours(), 4);
    assert.equal(new Date(spring.end).getHours(), 4);
    assert.equal(new Date(autumn.start).getHours(), 4);
    assert.equal(new Date(autumn.end).getHours(), 4);
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});
