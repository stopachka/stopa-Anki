import test from 'node:test';
import assert from 'node:assert/strict';
import { Rating } from 'ts-fsrs';
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

test('invalid saved dates or memory values are rejected instead of resetting progress', async () => {
  const scheduler = await makeScheduler();
  const stored = serializeCard(scheduler.newCard({ cardId: 'word', now: new Date() }));
  assert.throws(() => deserializeCard({ ...stored, dueAt: 'not-a-date' }));
  assert.throws(() => deserializeCard({ ...stored, stability: null }));
  assert.throws(() => deserializeCard({ ...stored, reps: -1 }));
  assert.throws(() => deserializeCard({ ...stored, state: 99 }));
});
