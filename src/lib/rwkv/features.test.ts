import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalizeReviews, deterministicFeatures, FeatureHistory, reviewSignature } from './features.ts';
import type { RawFeatureInput, ReviewRecord, WordIdentity } from './types.ts';

type FixtureRow = {
  features: number[];
  ids: number[];
  skip: boolean;
  isQuery: boolean;
  reviewTh: number;
  raw: { elapsed_seconds: number; elapsed_days: number; day_offset: number; day_offset_first: number; rating: number; duration: number; state: number };
};
const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/big-sm99-features.json', import.meta.url), 'utf8')) as {
  users: { user: number; rows: FixtureRow[] }[];
};

test('all 24 deterministic features match 1,024 official SM99 synthetic query/update vectors', () => {
  let rowsChecked = 0;
  for (const user of fixture.users) {
    const cards = new Map<number, { days: number; seconds: number; reviewTh: number; newCards: number }>();
    let today = -1;
    let reviewsToday = 0;
    let newCardsToday = 0;
    let previousDay = 0;
    for (const [index, row] of user.rows.entries()) {
      const cardId = row.ids[0];
      const previous = cards.get(cardId);
      const raw: RawFeatureInput = {
        elapsedDays: row.raw.elapsed_days,
        elapsedSeconds: row.raw.elapsed_seconds,
        cumulativeDays: (previous?.days ?? 0) + row.raw.elapsed_days,
        cumulativeSeconds: (previous?.seconds ?? 0) + row.raw.elapsed_seconds,
        durationMs: row.raw.duration,
        rating: row.raw.rating,
        state: row.raw.state,
        dayOffset: row.raw.day_offset,
        firstDayOffset: row.raw.day_offset_first,
        daysSinceAnyReview: row.raw.day_offset - previousDay,
        newCardsSinceLastReview: previous ? cards.size - previous.newCards : 0,
        reviewsSinceLastReview: previous ? Math.max(0, row.reviewTh - previous.reviewTh - 1) : 0,
        newCardsToday: (today === row.raw.day_offset ? newCardsToday : 0) + (previous ? 0 : 1),
        reviewsToday: today === row.raw.day_offset ? reviewsToday : 0,
        isQuery: row.isQuery,
      };
      const actual = deterministicFeatures(raw);
      for (let feature = 0; feature < 24; feature += 1) {
        assert.ok(Math.abs(actual[feature] - row.features[feature]) < 2e-6,
          `user ${user.user}, row ${index}, feature ${feature}: ${actual[feature]} vs ${row.features[feature]}`);
      }
      if (!row.skip) {
        if (today !== row.raw.day_offset) {
          today = row.raw.day_offset;
          reviewsToday = 0;
          newCardsToday = 0;
        }
        reviewsToday += 1;
        if (!previous) newCardsToday += 1;
        cards.set(cardId, { days: raw.cumulativeDays, seconds: raw.cumulativeSeconds,
          reviewTh: row.reviewTh, newCards: cards.size + (previous ? 0 : 1) });
        previousDay = row.raw.day_offset;
      }
      rowsChecked += 1;
    }
  }
  assert.equal(rowsChecked, 1024);
});

const words: WordIdentity[] = [{ id: 'one', book: 1 }, { id: 'two', book: 1 }, { id: 'three', book: 2 }];
const start = Date.parse('2026-11-21T23:59:50.000Z');
function review(id: string, wordId = 'one', reviewedAt = start, state = 0, durationMs?: number): ReviewRecord {
  return {
    id, ownerId: 'owner', wordId, book: words.find(word => word.id === wordId)?.book ?? 1,
    rating: 3, reviewedAt,
    log: {
      cardId: wordId, rating: 3, state: state as 0 | 1 | 2 | 3,
      reviewTime: new Date(reviewedAt).toISOString(), dueAt: new Date(reviewedAt).toISOString(), lastReviewAt: null,
      stability: 0, difficulty: 0, scheduleStatus: state === 0 ? 'new' : 'review', scheduledDays: 0,
      ...(durationMs === undefined ? {} : { durationMs }),
    },
  };
}

test('queries do not commit any counter, duration, rating, state, or identity assignment', () => {
  const history = new FeatureHistory(words);
  const untouched = new FeatureHistory([...words].reverse());
  const first = review('1');
  history.update(first);
  untouched.update(first);
  const expected = untouched.query(words[0], start + 5000);
  for (let index = 0; index < 5; index += 1) {
    history.query(words[2], start + index * 1000);
    history.query(words[1], start + index * 1000);
  }
  assert.deepEqual(history.query(words[0], start + 5000), expected);
  assert.deepEqual(history.reviewedWordIds(), ['one']);
  assert.deepEqual(Array.from(expected.features.slice(8, 13)), [0, 0, 0, 0, 0]);
  assert.equal(expected.features[22], 0);
  assert.equal(expected.features[23], 1);
  assert.deepEqual(history.update(review('2', 'two', start + 6000)), untouched.update(review('2', 'two', start + 6000)));
});

test('history uses answer-to-answer updates, show-time queries, and UTC calendar days', () => {
  const history = new FeatureHistory(words);
  const first = history.update(review('1', 'one', start, 0, 1200));
  assert.equal(first.features[22], -2);
  history.update(review('2', 'two', start + 5000, 0, 500));
  history.update(review('3', 'three', start + 8000, 0, 1000));
  const query = history.query(words[0], start + 30_000);
  const expected = deterministicFeatures({
    elapsedDays: 1, elapsedSeconds: 30, cumulativeDays: 0, cumulativeSeconds: 29,
    rating: 0, state: 2, dayOffset: 1, firstDayOffset: 0, daysSinceAnyReview: 1,
    newCardsSinceLastReview: 2, reviewsSinceLastReview: 2, newCardsToday: 0, reviewsToday: 0, isQuery: true,
  });
  assert.deepEqual(query.features.slice(0, 24), expected);
  const answer = history.update(review('4', 'one', start + 40_000, 1, 10000));
  assert.equal(answer.features[22], -1);
  assert.equal(answer.features[23], 0);
  assert.equal(answer.features[2], Math.fround((Math.log(1 + 1e-5 + 40) - 9.96) / 5.21));
  assert.equal(history.lastReviewAt('one'), start + 40_000);
  assert.deepEqual(query.ids, [1, 1, 1, 1, 1]);
  assert.deepEqual(history.query(words[2], start + 40_000).ids, [2, 2, 2, 1, 1]);
});

test('missing historical duration uses the native unknown encoding, preserving a measured zero', () => {
  const absent = new FeatureHistory(words).update(review('1')).features[8];
  const zero = new FeatureHistory(words).update(review('1', 'one', start, 0, 0)).features[8];
  assert.equal(absent, 0);
  assert.equal(zero, Math.fround((Math.log(10) - 8.9) / 1.07));
  assert.notEqual(zero, absent);
});

test('compact IDs and identity codes stay stable across registration and query order', () => {
  const left = new FeatureHistory(words);
  const right = new FeatureHistory([...words].reverse());
  for (const word of [...words].reverse()) left.query(word, start);
  for (const word of words) {
    assert.deepEqual(left.query(word, start), right.query(word, start));
    assert.ok([...left.query(word, start).features.slice(24, 64)].every(value => [-1.5, -0.5, 0.5, 1.5].includes(value)));
  }
  assert.throws(() => left.query({ id: 'unknown', book: 1 }, start), /Register/);
  left.registerWords([{ id: 'unknown', book: 1 }]);
  left.update(review('1'));
  assert.throws(() => left.registerWords(words), /before replaying/);
});

test('canonical replay deduplicates identical events and orders timestamp ties by stable IDs', () => {
  const a = review('a');
  const b = review('b', 'two');
  const c = review('c', 'one', start + 1000, 1);
  assert.deepEqual(canonicalizeReviews([c, b, a, { ...a }]).map(event => event.id), ['a', 'b', 'c']);
  assert.equal(reviewSignature(a), reviewSignature({ ...a, log: { ...a.log, stability: 100 } }));
  assert.throws(() => canonicalizeReviews([a, { ...a, log: { ...a.log, durationMs: 12 } }]), /Conflicting/);
  assert.throws(() => canonicalizeReviews([a, { ...b, ownerId: 'another' }]), /more than one account/);
  assert.throws(() => canonicalizeReviews([{ ...a, rating: 5 }]), /Invalid saved review/);
  assert.throws(() => canonicalizeReviews([{ ...a, log: { ...a.log, durationMs: NaN } }]), /duration/);
});

test('repeated or out-of-order commits fail before changing feature state', () => {
  const history = new FeatureHistory(words);
  history.update(review('b'));
  const before = history.query(words[0], start + 1000);
  assert.throws(() => history.update(review('b')), /already been applied/);
  assert.throws(() => history.update(review('a', 'two')), /chronological/);
  assert.throws(() => history.update(review('z', 'two', start - 1)), /chronological/);
  assert.deepEqual(history.query(words[0], start + 1000), before);
  assert.ok([...history.query(words[0], start - 60_000).features].every(Number.isFinite));
});
