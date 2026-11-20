import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { intersperse, isCardDue, learningAvailable, selectNextWord, StudyQueue, type QueueCard } from './queue.ts';
import { reviewDueDate, studyDayKey } from './time.ts';

const now = new Date(2026, 10, 20, 12);
const words = ['new', 'review', 'learning', 'interday', 'future'].map(id => ({ id }));
const card = (state: number, seconds: number): QueueCard => ({ state, dueAt: new Date(now.getTime() + seconds * 1000), reps: 1 });

test('due intraday learning precedes reviews, which precede new cards and learn-ahead', () => {
  const memories = { learning: card(1, -1), review: card(2, -60) };
  assert.equal(selectNextWord(words, memories, now)?.id, 'learning');
  memories.learning = card(1, 600);
  assert.equal(selectNextWord(words, memories, now)?.id, 'review');
  memories.review = card(2, 86400);
  assert.equal(selectNextWord(words, memories, now)?.id, 'new');
  assert.equal(selectNextWord(words, memories, now, 0)?.id, 'learning');
});

test('learn-ahead includes only learning within twenty minutes and before rollover', () => {
  assert.equal(selectNextWord([{ id: 'learning' }], { learning: card(3, 1200) }, now, 0)?.id, 'learning');
  assert.equal(selectNextWord([{ id: 'learning' }], { learning: card(1, 1201) }, now, 0), undefined);
  assert.equal(selectNextWord([{ id: 'review' }], { review: card(2, 60) }, now, 0), undefined);
  const late = new Date(2026, 10, 20, 3, 55);
  const tomorrow: QueueCard = { state: 1, dueAt: new Date(2026, 10, 20, 4, 5), anki: { dueDay: '2026-11-20' } };
  assert.equal(learningAvailable(tomorrow, late), false);
  assert.equal(selectNextWord([{ id: 'learning' }], { learning: tomorrow }, late, 0), undefined);
});

test('review and interday dates use study days; legacy timestamps retain their old deadline', () => {
  const dayReview: QueueCard = { state: 2, dueAt: new Date(2026, 10, 20, 23), anki: { dueDay: '2026-11-20' } };
  assert.equal(isCardDue(dayReview, now), true);
  assert.equal(isCardDue({ ...dayReview, anki: undefined }, now), false);
  const interday: QueueCard = { state: 1, dueAt: reviewDueDate(now, 1), anki: { dueDay: studyDayKey(reviewDueDate(now, 1)) } };
  assert.equal(learningAvailable(interday, now), false);
  assert.equal(learningAvailable(interday, reviewDueDate(now, 1)), true);
});

test('Anki Intersperser preserves the reference evenly mixed ordering', () => {
  assert.deepEqual(intersperse([1, 2, 3], [11, 22, 33]), [1, 11, 2, 22, 3, 33]);
  assert.deepEqual(intersperse([1, 2, 3], [11, 22, 33, 44, 55, 66]), [11, 1, 22, 33, 2, 44, 55, 3, 66]);
  assert.deepEqual(intersperse([1, 2, 3], []), [1, 2, 3]);
});

test('a learning card requeues behind another available card without changing its saved date', () => {
  const queue = new StudyQueue();
  const pool = ['a', 'b'].map(id => ({ id }));
  const memories = { a: card(1, 60), b: card(1, 600) };
  assert.equal(queue.next(pool, memories, now, 0)?.id, 'a');
  const actualDue = memories.a.dueAt.getTime();
  queue.answer('a', memories, pool, now, 0);
  assert.equal(queue.next(pool, memories, now, 0)?.id, 'b');
  assert.equal(memories.a.dueAt.getTime(), actualDue);
  queue.answer('b', memories, pool, now, 0);
  assert.equal(queue.next(pool, memories, now, 0)?.id, 'a');
});

test('learn-ahead does not block the only remaining card and resets on a new session', () => {
  const queue = new StudyQueue();
  const pool = [{ id: 'a' }];
  const memories = { a: card(1, 60) };
  queue.answer('a', memories, pool, now, 0);
  assert.equal(queue.next(pool, memories, now, 0)?.id, 'a');
  queue.reset();
  assert.equal(queue.next([{ id: 'new' }], {}, now, 1)?.id, 'new');
});

test('learning counts exclude future interday and distant learning cards', () => {
  assert.equal(learningAvailable(card(1, 1200), now), true);
  assert.equal(learningAvailable(card(3, 1201), now), false);
  assert.equal(learningAvailable(card(2, -1), now), false);
  assert.equal(learningAvailable({ ...card(1, 60), anki: { dueDay: '2026-11-21' } }, now), false);
});

type QueueFixture = {
  name: string;
  now: string;
  cards: { wordId: string; state: number; dueOffsetSeconds?: number; dueOffsetDays?: number }[];
  newLimit: number;
  expected: { nextWordId: string | null; newCount: number; learningCount: number; reviewCount: number };
};
type QueueSequenceFixture = { name: string; now: string; cards: QueueFixture['cards']; expectedOrder: string[] };
const fixtures = JSON.parse(readFileSync(new URL('../__fixtures__/anki-reference.json', import.meta.url), 'utf8')) as { queueCases: QueueFixture[]; queueSequenceCases: QueueSequenceFixture[] };

for (const fixture of fixtures.queueCases) {
  test(`official Anki queue parity: ${fixture.name}`, () => {
    const time = new Date(fixture.now);
    const pool = fixture.cards.map(row => ({ id: row.wordId }));
    const memories: Record<string, QueueCard> = {};
    for (const row of fixture.cards) {
      if (row.state === 0) continue;
      const dueAt = row.dueOffsetDays === undefined
        ? new Date(time.getTime() + (row.dueOffsetSeconds ?? 0) * 1000)
        : reviewDueDate(time, row.dueOffsetDays);
      memories[row.wordId] = { state: row.state, dueAt, reps: 1, ...(row.dueOffsetDays === undefined ? {} : { anki: { dueDay: studyDayKey(dueAt) } }) };
    }
    assert.equal(selectNextWord(pool, memories, time, fixture.newLimit)?.id ?? null, fixture.expected.nextWordId);
    const queue = new StudyQueue();
    assert.equal(queue.next(pool, memories, time, fixture.newLimit)?.id ?? null, fixture.expected.nextWordId);
    assert.equal(Math.min(fixture.newLimit, fixture.cards.filter(row => row.state === 0).length), fixture.expected.newCount);
    assert.equal(Object.values(memories).filter(card => learningAvailable(card, time)).length, fixture.expected.learningCount);
    assert.equal(Object.values(memories).filter(card => card.state === 2 && isCardDue(card, time)).length, fixture.expected.reviewCount);
  });
}

test('official Anki interday mix keeps its session order after each answer', () => {
  const fixture = fixtures.queueSequenceCases.find(row => row.name === 'interday-learning-mixed-with-reviews');
  assert.ok(fixture, 'official queue sequence fixture exists');
  const time = new Date(fixture.now);
  const pool = fixture.cards.map(row => ({ id: row.wordId }));
  const memories: Record<string, QueueCard> = {};
  for (const row of fixture.cards) {
    const dueAt = reviewDueDate(time, 0);
    dueAt.setDate(dueAt.getDate() + (row.dueOffsetDays ?? 0));
    memories[row.wordId] = { state: row.state, dueAt, reps: 1, anki: { dueDay: studyDayKey(dueAt) } };
  }
  const queue = new StudyQueue();
  const actual: string[] = [];
  for (let i = 0; i < fixture.expectedOrder.length; i++) {
    const next = queue.next(pool, memories, time, 0);
    assert.ok(next);
    actual.push(next.id);
    const dueAt = reviewDueDate(time, 10);
    memories[next.id] = { state: 2, dueAt, reps: 2, anki: { dueDay: studyDayKey(dueAt) } };
    queue.answer(next.id, memories, pool, time, 0);
  }
  assert.deepEqual(actual, fixture.expectedOrder);
  assert.equal(queue.next(pool, memories, time, 0), undefined);
});
