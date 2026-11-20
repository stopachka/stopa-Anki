import test from 'node:test';
import assert from 'node:assert/strict';
import { Rating, State } from './anki/types.ts';
import { answerIntervalLabel, makeScheduler, nextWord, summarizeWords } from './scheduler.ts';
import type { Word } from '../types.ts';

const words: Word[] = [1, 2, 3].map(id => ({ id: String(id), traditional: '學', pinyin: 'xué', english: 'learn', book: 1, chapter: 1 }));
const now = new Date('2026-11-19T12:00:00Z');

test('a rating updates FSRS state without mutating the source card', async () => {
  const scheduler = await makeScheduler();
  const card = scheduler.newCard({ cardId: '1', now });
  const again = scheduler.review({ card, grade: Rating.Again, now });
  const good = scheduler.review({ card, grade: Rating.Good, now });
  assert.equal(card.reps, 0);
  assert.equal(again.card.reps, 1);
  assert.equal(good.revlog.rating, Rating.Good);
  assert.ok(again.card.dueAt > now);
  assert.ok(good.card.dueAt > again.card.dueAt);
  assert.equal(answerIntervalLabel(again), '<1 min');
  assert.equal(answerIntervalLabel(good), '<10 min');
});

test('due learning takes priority; learn-ahead waits until the main queue is empty', async () => {
  const scheduler = await makeScheduler({ enableFuzz: false });
  const card = scheduler.newCard({ cardId: '2', now });
  const rated = scheduler.review({ card, grade: Rating.Again, now }).card;
  const memories = { '2': rated };
  assert.equal(nextWord(words, memories, now)?.id, '1');
  assert.equal(nextWord(words, memories, new Date(now.getTime() + 60_001))?.id, '2');
  assert.equal(nextWord([words[1]], memories, now)?.id, '2');
  const graduated = scheduler.review({ card: rated, grade: Rating.Easy, now }).card;
  assert.equal(nextWord([words[1]], { '2': graduated }, now), undefined);
});

test('the active scope controls which deck and chapter can be reviewed', async () => {
  const scheduler = await makeScheduler();
  const card = scheduler.newCard({ cardId: '1', now });
  assert.equal(nextWord([words[2]], { '1': card }, now)?.id, '3');
  assert.equal(nextWord([], {}, now), undefined);
});

test('deck counters separate unseen, learning, and due reviews without counting future reviews', async () => {
  const scheduler = await makeScheduler();
  const moreWords = [1, 2, 3, 4, 5].map(id => ({ ...words[0], id: String(id) }));
  const base = scheduler.newCard({ now });
  const memories = {
    '2': { ...base, state: State.Learning, dueAt: new Date(now.getTime() + 60_000) },
    '3': { ...base, state: State.Review, dueAt: new Date(now.getTime() - 60_000) },
    '4': { ...base, state: State.Review, dueAt: new Date(now.getTime() + 86_400_000) },
    '5': { ...base, state: State.Relearning, dueAt: new Date(now.getTime() + 600_000) },
  };
  assert.deepEqual(summarizeWords(moreWords, memories, now), { total: 5, newCount: 1, learningCount: 2, reviewCount: 1, started: 4 });
  assert.equal(summarizeWords(moreWords, memories, new Date(now.getTime() + 86_400_001)).reviewCount, 2);
  assert.deepEqual(summarizeWords([moreWords[0]], memories, now), { total: 1, newCount: 1, learningCount: 0, reviewCount: 0, started: 0 });
});

test('exhausting the new-word allowance still serves due learning and review cards', async () => {
  const scheduler = await makeScheduler();
  const base = scheduler.newCard({ now });
  const memories = {
    '2': { ...base, state: State.Learning, dueAt: new Date(now.getTime() - 60_000) },
    '3': { ...base, state: State.Review, dueAt: new Date(now.getTime() - 30_000) },
  };
  assert.equal(nextWord(words, {}, now, 0), undefined);
  assert.equal(nextWord(words, {}, now, 1)?.id, '1');
  assert.equal(nextWord(words, memories, now, 0)?.id, '2');
  assert.equal(nextWord([words[0], words[2]], memories, now, 0)?.id, '3');
  assert.equal(nextWord(words, { '1': base }, now, 0), undefined);
  assert.equal(nextWord(words, { '1': base }, now, 1)?.id, '1');
});

test('the blue counter is capped by today’s allowance without changing total progress', async () => {
  const scheduler = await makeScheduler();
  const base = scheduler.newCard({ now });
  const memories = { '3': { ...base, state: State.Learning } };
  assert.deepEqual(summarizeWords(words, memories, now, 1), { total: 3, newCount: 1, learningCount: 1, reviewCount: 0, started: 1 });
  assert.deepEqual(summarizeWords(words, memories, now, 0), { total: 3, newCount: 0, learningCount: 1, reviewCount: 0, started: 1 });
  assert.equal(summarizeWords(words, memories, now, 10).newCount, 2);
  assert.equal(summarizeWords(words, memories, now, 10).started, 1);
});
