import { isCardDue, learningAvailable, StudyQueue, type QueueCard } from '../anki/queue.ts';
import { State } from '../anki/types.ts';
import type { WordCounts } from '../scheduler.ts';

export type RecallScore = { id: string; recall: number };
type Word = { id: string };
type RwkvMemory = QueueCard & { lastReviewAt?: Date | null };
type Memories = Record<string, RwkvMemory>;

export const RWKV_TARGET_RETENTION = 0.9;
// Instant predictions may remain below target immediately after an answer.
// Like the upstream scheduler's minimum-elapsed guard, this applies to both
// review and learning cards, including steps pulled forward by learn-ahead.
export const RWKV_MIN_REPEAT_MS = 60_000;

function isLearning(card: RwkvMemory): boolean {
  return card.state === State.Learning || card.state === State.Relearning;
}

function canRepeat(card: RwkvMemory, now: Date): boolean {
  return !card.lastReviewAt || now.getTime() - card.lastReviewAt.getTime() >= RWKV_MIN_REPEAT_MS;
}

function recallMap(scores: readonly RecallScore[]): Map<string, number> {
  return new Map(scores.map(score => [score.id, score.recall]));
}

function reviewRecall(id: string, scores: Map<string, number>): number {
  const recall = scores.get(id);
  // A missing or failed model prediction must not silently remove a review or
  // turn an incomplete score map into a misleading "Caught up" screen.
  if (recall === undefined || !Number.isFinite(recall) || recall < 0 || recall > 1) {
    throw new Error(`No valid recall prediction for ${id}`);
  }
  return recall;
}

function newAllowance(remainingNew: number): number {
  return Number.isNaN(remainingNew) ? 0 : Math.max(0, Math.floor(remainingNew));
}

/**
 * RWKV-Instant selects review cards at or below target regardless of the saved
 * fallback due date. This follows the eligibility rule documented by the
 * JSchoreels Anki fork; the app uses a fixed 90% target and 60-second repeat
 * guard, with no minimum intervening-review count or daily review floor.
 * https://github.com/JSchoreels/anki/blob/main/docs/rwkv.MD
 *
 * Anki's configured learning steps, learn-ahead ordering and textbook new-card
 * order remain in effect. The score map must cover every Review-state card.
 */
export class RwkvStudyQueue {
  private learningQueue = new StudyQueue();

  reset(): void { this.learningQueue.reset(); }

  next<T extends Word>(words: T[], memories: Memories, now: Date, scores: readonly RecallScore[], remainingNew = Infinity): T | undefined {
    const predictions = recallMap(scores);
    const reviews = words.flatMap((word, index) => {
      const card = memories[word.id];
      if (!card || card.state !== State.Review) return [];
      const recall = reviewRecall(word.id, predictions);
      return recall <= RWKV_TARGET_RETENTION && canRepeat(card, now) ? [{ word, recall, index }] : [];
    }).sort((a, b) => a.recall - b.recall || a.index - b.index);
    const learning = words.filter(word => {
      const card = memories[word.id];
      return card && isLearning(card) && canRepeat(card, now);
    });
    const nextLearning = this.learningQueue.next(learning, memories, now, 0);
    if (nextLearning && isCardDue(memories[nextLearning.id], now)) return nextLearning;
    if (reviews.length) return reviews[0].word;
    if (newAllowance(remainingNew) > 0) {
      const unseen = words.find(word => !memories[word.id] || memories[word.id].state === State.New);
      if (unseen) return unseen;
    }
    return nextLearning;
  }

  answer(wordId: string, memories: Memories, words: Word[], now: Date, _scores: readonly RecallScore[], _remainingNew = Infinity): void {
    const learning = words.filter(word => memories[word.id] && isLearning(memories[word.id]));
    this.learningQueue.answer(wordId, memories, learning, now, 0);
  }
}

/** Counts use precisely the same recall and repeat guards as study selection. */
export function summarizeRwkvWords(words: Word[], memories: Memories, now: Date, scores: readonly RecallScore[], remainingNew = Infinity): WordCounts {
  const predictions = recallMap(scores);
  const counts: WordCounts = { total: words.length, newCount: 0, learningCount: 0, reviewCount: 0, started: 0 };
  for (const word of words) {
    const card = memories[word.id];
    if (!card || card.state === State.New) counts.newCount++;
    else if (card.state === State.Review) {
      if (reviewRecall(word.id, predictions) <= RWKV_TARGET_RETENTION && canRepeat(card, now)) counts.reviewCount++;
    } else if (learningAvailable(card, now) && canRepeat(card, now)) counts.learningCount++;
  }
  counts.started = counts.total - counts.newCount;
  counts.newCount = Math.min(counts.newCount, newAllowance(remainingNew));
  return counts;
}
