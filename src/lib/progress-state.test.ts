import test from 'node:test';
import assert from 'node:assert/strict';
import { Rating } from 'ts-fsrs';
import { makeScheduler, nextWord } from './scheduler.ts';
import { mergeProgress, pendingCommittedCards } from './progress-state.ts';
import type { Word } from '../types.ts';

test('an acknowledged last-card review stays scheduled while the query catches up', async () => {
  const scheduler = await makeScheduler();
  const now = new Date('2026-11-19T12:00:00Z');
  const word: Word = { id: 'word', traditional: '學', pinyin: 'xué', english: 'learn', book: 1, chapter: 1 };
  const card = scheduler.review({ card: scheduler.newCard({ cardId: word.id, now }), grade: Rating.Good, now }).card;
  const committed = { [word.id]: card };
  const merged = mergeProgress({}, committed);
  assert.equal(nextWord([word], merged, now), undefined);
  assert.equal(merged[word.id], card);
  assert.equal(pendingCommittedCards({}, committed), committed);
  assert.deepEqual(pendingCommittedCards(merged, committed), {});
});

test('a newer remote review and unrelated remote cards are never hidden by the overlay', async () => {
  const scheduler = await makeScheduler();
  const now = new Date('2026-11-19T12:00:00Z');
  const older = scheduler.review({ card: scheduler.newCard({ cardId: 'word', now }), grade: Rating.Good, now }).card;
  const newer = scheduler.review({ card: older, grade: Rating.Easy, now: new Date(now.getTime() + 600_000) }).card;
  const other = scheduler.newCard({ cardId: 'other', now });
  const remote = { word: newer, other };
  assert.equal(mergeProgress(remote, { word: older }), remote);
  assert.deepEqual(pendingCommittedCards(remote, { word: older }), {});
  assert.equal(mergeProgress({ other }, { word: older }).other, other);
});
