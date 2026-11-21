import test from 'node:test';
import assert from 'node:assert/strict';
import { Rating } from './anki/types.ts';
import { makeScheduler } from './scheduler.ts';
import { deserializeCard, serializeCard, serializeReviewLog } from './card-codec.ts';

test('saved FSRS dates round-trip through JSON and produce the same next schedule', async () => {
  const scheduler = await makeScheduler();
  const firstReview = new Date('2026-11-19T23:59:00.123Z');
  const nextReview = new Date('2026-11-20T00:09:00.456Z');
  const card = scheduler.review({ card: scheduler.newCard({ cardId: 'pavc-b1-0001', now: firstReview }), grade: Rating.Good, now: firstReview }).card;
  const revived = deserializeCard(JSON.parse(JSON.stringify(serializeCard(card))));
  assert.deepEqual(revived, card);
  assert.deepEqual(scheduler.review({ card: revived, grade: Rating.Good, now: nextReview }), scheduler.review({ card, grade: Rating.Good, now: nextReview }));
});

test('new cards keep null previous review dates and review logs retain their timestamp', async () => {
  const scheduler = await makeScheduler();
  const now = new Date('2026-11-19T12:00:00.000Z');
  const card = scheduler.newCard({ cardId: 'word', now });
  assert.equal(deserializeCard(serializeCard(card)).lastReviewAt, null);
  const log = scheduler.review({ card, grade: Rating.Again, now }).revlog;
  const stored = serializeReviewLog(log);
  assert.equal(stored.reviewTime, now.toISOString());
  assert.equal(stored.lastReviewAt, null);
  assert.equal(stored.rating, Rating.Again);
});

test('review timing is retained without inventing measurements for legacy logs', () => {
  const scheduler = makeScheduler();
  const now = new Date('2026-11-21T12:00:00Z');
  const log = scheduler.review({ card: scheduler.newCard({ cardId: 'word', now }), grade: Rating.Good, now }).revlog;
  const legacy = serializeReviewLog(log);
  assert.equal('shownAt' in legacy, false);
  assert.equal('durationMs' in legacy, false);
  const timed = serializeReviewLog({ ...log, shownAt: now.getTime() - 5000, durationMs: 4300 });
  assert.equal(JSON.parse(JSON.stringify(timed)).shownAt, now.getTime() - 5000);
  assert.equal(JSON.parse(JSON.stringify(timed)).durationMs, 4300);
  assert.throws(() => serializeReviewLog({ ...log, shownAt: now.getTime() + 1 }));
  assert.throws(() => serializeReviewLog({ ...log, durationMs: -1 }));
  assert.throws(() => serializeReviewLog({ ...log, durationMs: NaN }));
});

test('invalid saved dates or memory values are rejected instead of resetting progress', async () => {
  const scheduler = await makeScheduler();
  const stored = serializeCard(scheduler.newCard({ cardId: 'word', now: new Date() }));
  assert.throws(() => deserializeCard({ ...stored, dueAt: 'not-a-date' }));
  assert.throws(() => deserializeCard({ ...stored, stability: null }));
  assert.throws(() => deserializeCard({ ...stored, reps: -1 }));
  assert.throws(() => deserializeCard({ ...stored, state: 99 }));
});

test('legacy cards load without adding metadata or changing their saved deadlines', () => {
  const stored = {
    cardId: 'pavc-b1-0001',
    dueAt: '2026-11-20T00:09:00.456Z',
    lastReviewAt: '2026-11-19T23:59:00.123Z',
    stability: 2.3065, difficulty: 2.1181, reps: 1, lapses: 0,
    scheduledDays: 0, state: 1, scheduleStatus: 'learning', learningStep: 1,
  };
  const revived = deserializeCard(JSON.parse(JSON.stringify(stored)));
  assert.equal('anki' in revived, false);
  assert.equal(revived.dueAt.toISOString(), stored.dueAt);
  assert.equal(revived.lastReviewAt?.toISOString(), stored.lastReviewAt);
  assert.deepEqual(serializeCard(revived), stored);
});

test('learning and day-based Anki metadata survive JSON storage, including u64 seed IDs', () => {
  const scheduler = makeScheduler({ enableFuzz: false });
  const now = new Date('2026-11-19T12:00:00.000Z');
  for (const grade of [Rating.Again, Rating.Easy]) {
    const card = scheduler.review({ card: scheduler.newCard({ cardId: 'word', now }), grade, now }).card;
    card.anki = { ...card.anki!, seedId: '18446744073709551615', leeched: true };
    const revived = deserializeCard(JSON.parse(JSON.stringify(serializeCard(card))));
    assert.deepEqual(revived, card);
    assert.equal(revived.anki?.seedId, '18446744073709551615');
    assert.equal(!!revived.anki?.dueDay, grade === Rating.Easy);
  }
});

test('malformed Anki metadata is rejected before it can replace saved progress', () => {
  const scheduler = makeScheduler();
  const now = new Date('2026-11-19T12:00:00.000Z');
  const card = scheduler.review({ card: scheduler.newCard({ cardId: 'word', now }), grade: Rating.Good, now }).card;
  const stored = serializeCard(card);
  const metadata = stored.anki!;
  const invalidMetadata: unknown[] = [
    null, [], 'metadata', {},
    { ...metadata, version: 2 },
    ...['', '-1', '1.5', '1e3', '18446744073709551616'].map(seedId => ({ ...metadata, seedId })),
    { ...metadata, seedId: 123 },
    ...[-1, 0.5, NaN, Infinity, 0x100000000].flatMap(number => [
      { ...metadata, remainingSteps: number }, { ...metadata, scheduledSeconds: number },
    ]),
    ...[0, -1, Infinity, NaN, '2.5'].map(easeFactor => ({ ...metadata, easeFactor })),
    ...['2026-2-01', '2026-02-30', '2026-13-01', 'not-a-day', null].map(dueDay => ({ ...metadata, dueDay })),
    { ...metadata, leeched: 1 },
  ];
  for (const anki of invalidMetadata) assert.throws(() => deserializeCard({ ...stored, anki }), Error, JSON.stringify(anki));
  assert.throws(() => serializeCard({ ...card, anki: { ...metadata, scheduledSeconds: -1 } }));
  assert.equal(deserializeCard({ ...stored, anki: { ...metadata, dueDay: '2028-02-29', leeched: false } }).anki?.dueDay, '2028-02-29');
});
