import { DefaultScheduler, Rating, State, type Grade } from 'ts-fsrs';
import type { Word } from '../types.ts';

// Pin the model separately from the package version.
export const makeScheduler = () => DefaultScheduler({
  version: 'FSRS-6',
  desiredRetention: 0.9,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['1m'],
  enableFuzz: false,
});

export type Scheduler = Awaited<ReturnType<typeof makeScheduler>>;
export type MemoryCard = ReturnType<Scheduler['newCard']>;
export type ReviewLog = ReturnType<Scheduler['review']>['revlog'];
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
    else if (card.state === State.Learning || card.state === State.Relearning) counts.learningCount++;
    else if (card.state === State.Review && card.dueAt <= now) counts.reviewCount++;
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
  const due = words.filter(word => memories[word.id] && memories[word.id].state !== State.New && memories[word.id].dueAt <= now);
  due.sort((a, b) => memories[a.id].dueAt.getTime() - memories[b.id].dueAt.getTime());
  return due[0] ?? (remainingNew > 0 ? words.find(word => !memories[word.id] || memories[word.id].state === State.New) : undefined);
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
