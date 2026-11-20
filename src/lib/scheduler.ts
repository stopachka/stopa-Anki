import { makeAnkiScheduler } from './anki/scheduler.ts';
import { Rating, State, type Grade, type MemoryCard, type ReviewLog, type ReviewResult } from './anki/types.ts';
import { isCardDue, learningAvailable, selectNextWord } from './anki/queue.ts';
import type { Word } from '../types.ts';

export { Rating, State } from './anki/types.ts';
export type { Grade, MemoryCard, ReviewLog } from './anki/types.ts';
export { StudyQueue } from './anki/queue.ts';

export const makeScheduler = makeAnkiScheduler;

export type Scheduler = Awaited<ReturnType<typeof makeScheduler>>;
export type Memories = Record<string, MemoryCard>;

export interface WordCounts {
  total: number;
  newCount: number;
  learningCount: number;
  reviewCount: number;
  started: number;
}

export function summarizeWords(words: Word[], memories: Memories, now: Date, remainingNew = Infinity): WordCounts {
  const counts: WordCounts = { total: words.length, newCount: 0, learningCount: 0, reviewCount: 0, started: 0 };
  for (const word of words) {
    const card = memories[word.id];
    if (!card || card.state === State.New) counts.newCount++;
    else if (learningAvailable(card, now)) counts.learningCount++;
    else if (card.state === State.Review && isCardDue(card, now)) counts.reviewCount++;
  }
  counts.started = counts.total - counts.newCount;
  counts.newCount = Math.min(counts.newCount, Math.max(0, Math.floor(remainingNew)));
  return counts;
}

export const grades: { rating: Grade; label: string }[] = [
  { rating: Rating.Again, label: 'Again' },
  { rating: Rating.Hard, label: 'Hard' },
  { rating: Rating.Good, label: 'Good' },
  { rating: Rating.Easy, label: 'Easy' },
];

// Due reviews have priority; unseen vocabulary stays in textbook order.
export function nextWord(words: Word[], memories: Memories, now: Date, remainingNew = Infinity): Word | undefined {
  return selectNextWord(words, memories, now, remainingNew);
}

// Answer buttons display the scheduled interval; intraday learning can be
// brought forward by Anki's learn-ahead queue, and actual due times include fuzz.
export function answerIntervalLabel(result: ReviewResult): string {
  if (result.interval.kind === 'seconds') {
    const seconds = result.interval.value;
    const value = seconds < 60 ? `${seconds} sec` : seconds < 3600 ? `${Math.round(seconds / 60)} min` : `${Math.round(seconds / 3600)} hr`;
    return `${seconds < 1200 ? '<' : ''}${value}`;
  }
  const days = result.interval.value;
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'}`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${(days / 365).toFixed(1)} yr`;
}

export function intervalLabel(due: Date, now: Date): string {
  const minutes = Math.max(1, Math.round((due.getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} hr`;
  const days = Math.round(minutes / 1440);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'}`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${(days / 365).toFixed(1)} yr`;
}
