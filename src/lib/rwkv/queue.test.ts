import test from 'node:test';
import assert from 'node:assert/strict';
import { State } from '../anki/types.ts';
import { RwkvStudyQueue, summarizeRwkvWords, RWKV_MIN_REPEAT_MS, type RecallScore } from './queue.ts';

const now = new Date(2026, 10, 21, 12);
const words = ['new-a', 'new-b', 'review-a', 'review-b', 'learning', 'relearning'].map(id => ({ id }));
function memory(state: number, dueOffset: number, lastOffset = -86_400_000) {
  return { state, dueAt: new Date(now.getTime() + dueOffset), lastReviewAt: new Date(now.getTime() + lastOffset), reps: 2 };
}

test('Instant selects future-due low-recall reviews and withholds overdue high-recall reviews', () => {
  const queue = new RwkvStudyQueue();
  const memories = {
    'review-a': memory(State.Review, 30 * 86_400_000),
    'review-b': memory(State.Review, -30 * 86_400_000),
  };
  const scores = [{ id: 'review-a', recall: 0.7 }, { id: 'review-b', recall: 0.95 }];
  assert.equal(queue.next(words, memories, now, scores, 0)?.id, 'review-a');
  assert.deepEqual(summarizeRwkvWords(words, memories, now, scores, 0), {
    total: 6, newCount: 0, learningCount: 0, reviewCount: 1, started: 2,
  });
  assert.equal(queue.next([words[3]], memories, now, scores, 0), undefined);
});

test('fresh model scores reorder review cards; eligibility includes exactly target retention', () => {
  const queue = new RwkvStudyQueue();
  const memories = { 'review-a': memory(State.Review, 0), 'review-b': memory(State.Review, 0) };
  const scores = [{ id: 'review-a', recall: 0.9 }, { id: 'review-b', recall: 0.8 }];
  assert.equal(queue.next(words, memories, now, scores, 0)?.id, 'review-b');
  scores[0].recall = 0.7;
  assert.equal(queue.next(words, memories, now, scores, 0)?.id, 'review-a');
  scores[0].recall = 0.9;
  scores[1].recall = 0.99;
  assert.equal(queue.next(words, memories, now, scores, 0)?.id, 'review-a');
});

test('due learning precedes Instant reviews, which precede textbook new cards and learn-ahead', () => {
  const queue = new RwkvStudyQueue();
  const memories = { learning: memory(State.Learning, -1), 'review-a': memory(State.Review, 86_400_000) };
  const scores = [{ id: 'review-a', recall: 0.7 }];
  assert.equal(queue.next(words, memories, now, scores, 10)?.id, 'learning');
  memories.learning = memory(State.Learning, 600_000);
  assert.equal(queue.next(words, memories, now, scores, 10)?.id, 'review-a');
  scores[0].recall = 0.99;
  assert.equal(queue.next(words, memories, now, scores, 1)?.id, 'new-a');
  assert.equal(queue.next(words, memories, now, scores, 0)?.id, 'learning');
});

test('review and learning repeats wait one minute even after queue reset or reload', () => {
  const pool = [{ id: 'a' }];
  for (const state of [State.Review, State.Learning, State.Relearning]) {
    const memories = { a: memory(state, -1, 0) };
    const scores = [{ id: 'a', recall: 0.1 }];
    const queue = new RwkvStudyQueue();
    assert.equal(queue.next(pool, memories, now, scores, 0), undefined);
    queue.answer('a', memories, pool, now, scores, 0);
    queue.reset();
    assert.equal(new RwkvStudyQueue().next(pool, memories, new Date(now.getTime() + RWKV_MIN_REPEAT_MS - 1), scores, 0), undefined);
    const eligibleAt = new Date(now.getTime() + RWKV_MIN_REPEAT_MS);
    assert.equal(queue.next(pool, memories, eligibleAt, scores, 0)?.id, 'a');
    const before = summarizeRwkvWords(pool, memories, now, scores, 0);
    const after = summarizeRwkvWords(pool, memories, eligibleAt, scores, 0);
    assert.equal(before.reviewCount + before.learningCount, 0);
    assert.equal(after.reviewCount + after.learningCount, 1);
  }
});

test('answering Again can return through its learning step despite a high recall score', () => {
  const queue = new RwkvStudyQueue();
  const pool = [{ id: 'a' }, { id: 'b' }];
  const memories = { a: memory(State.Relearning, 60_000, 0), b: memory(State.Review, 86_400_000) };
  const scores = [{ id: 'a', recall: 0.99 }, { id: 'b', recall: 0.5 }];
  queue.answer('a', memories, pool, now, scores, 0);
  assert.equal(queue.next(pool, memories, now, scores, 0)?.id, 'b');
  assert.equal(queue.next(pool, memories, new Date(now.getTime() + 60_000), scores, 0)?.id, 'a');
});

test('learn-ahead retains the twenty-minute bound and excludes future interday steps', () => {
  const queue = new RwkvStudyQueue();
  const pool = [{ id: 'a' }];
  assert.equal(queue.next(pool, { a: memory(State.Learning, 1_200_000) }, now, [], 0)?.id, 'a');
  assert.equal(queue.next(pool, { a: memory(State.Learning, 1_200_001) }, now, [], 0), undefined);
  const tomorrow = { ...memory(State.Learning, 86_400_000), anki: { dueDay: '2026-11-22' } };
  assert.equal(queue.next(pool, { a: tomorrow }, now, [], 0), undefined);
  assert.equal(summarizeRwkvWords(pool, { a: tomorrow }, now, [], 0).learningCount, 0);
});

test('exhausted daily new allowance still serves learned cards and preserves total progress', () => {
  const memories = { 'review-a': memory(State.Review, 1000) };
  const scores = [{ id: 'review-a', recall: 0.5 }];
  const queue = new RwkvStudyQueue();
  assert.equal(queue.next(words, memories, now, scores, 0)?.id, 'review-a');
  assert.equal(queue.next(words.slice(0, 2), memories, now, scores, 0), undefined);
  assert.equal(queue.next(words.slice(0, 2), memories, now, scores, 1)?.id, 'new-a');
  assert.equal(summarizeRwkvWords(words, memories, now, scores, 1).newCount, 1);
  assert.equal(summarizeRwkvWords(words, memories, now, scores, 0).started, 1);
});

test('review ranking is restricted to the active book and ties follow textbook order', () => {
  const queue = new RwkvStudyQueue();
  const memories = { 'review-a': memory(State.Review, 0), 'review-b': memory(State.Review, 0) };
  const scores = [{ id: 'review-a', recall: 0.2 }, { id: 'review-b', recall: 0.2 }];
  assert.equal(queue.next(words, memories, now, scores, 0)?.id, 'review-a');
  assert.equal(queue.next([words[3]], memories, now, scores, 0)?.id, 'review-b');
  assert.equal(queue.next([], memories, now, scores, 0), undefined);
});

test('missing or invalid review predictions throw instead of silently reporting caught up', () => {
  const queue = new RwkvStudyQueue();
  const pool = [{ id: 'a' }];
  const memories = { a: memory(State.Review, 86_400_000) };
  for (const scores of [[], [{ id: 'a', recall: NaN }], [{ id: 'a', recall: Infinity }], [{ id: 'a', recall: -1 }], [{ id: 'a', recall: 1.01 }]] as RecallScore[][]) {
    assert.throws(() => queue.next(pool, memories, now, scores, 0), /No valid recall prediction/);
    assert.throws(() => summarizeRwkvWords(pool, memories, now, scores, 0), /No valid recall prediction/);
  }
});
