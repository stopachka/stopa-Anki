import { State } from 'ts-fsrs';

export const DEFAULT_DAILY_NEW_LIMIT = 10;

export type DailyReview = {
  wordId: string;
  reviewedAt: number;
  log?: { state?: number } | null;
};

export function normalizeDailyNewLimit(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 999
    ? value
    : DEFAULT_DAILY_NEW_LIMIT;
}

// Construct both midnights in local calendar time so DST days may be 23 or 25 hours.
export function dayBounds(now: Date): { start: number; end: number } {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  return { start: new Date(year, month, day).getTime(), end: new Date(year, month, day + 1).getTime() };
}

export function introducedWordIds(reviews: Iterable<DailyReview>, now: Date): Set<string> {
  const { start, end } = dayBounds(now);
  const introduced = new Set<string>();
  for (const review of reviews) {
    // The review log describes the state before rating, not the resulting state.
    if (review.log?.state === State.New && review.reviewedAt >= start && review.reviewedAt < end) {
      introduced.add(review.wordId);
    }
  }
  return introduced;
}

export function remainingNewWords(limit: number, introductions: Iterable<string>): number {
  return Math.max(0, normalizeDailyNewLimit(limit) - new Set(introductions).size);
}
