import type { ReviewRecord } from '../card-codec.ts';

export type { ReviewRecord } from '../card-codec.ts';

export interface WordIdentity {
  id: string;
  book: number;
}

// One bank per entity scope, in the pretrained model's order.
export type ScopeIds = readonly [number, number, number, number, number];

export interface ModelInput {
  features: Float32Array;
  ids: ScopeIds;
}

export interface FeatureCardState {
  lastReviewAt: number;
  firstDayOffset: number;
  cumulativeDays: number;
  cumulativeSeconds: number;
  lastReviewIndex: number;
  lastNewCardCount: number;
}

export interface RawFeatureInput {
  elapsedDays: number;
  elapsedSeconds: number;
  cumulativeDays: number;
  cumulativeSeconds: number;
  durationMs?: number;
  rating: number;
  state: number;
  dayOffset: number;
  firstDayOffset: number;
  daysSinceAnyReview: number;
  newCardsSinceLastReview: number;
  reviewsSinceLastReview: number;
  newCardsToday: number;
  reviewsToday: number;
  isQuery: boolean;
}

export interface FeatureHistoryApi {
  registerWords(words: readonly WordIdentity[]): void;
  query(word: WordIdentity, atMs: number, state?: number): ModelInput;
  update(event: ReviewRecord): ModelInput;
  reviewedWordIds(): string[];
  lastReviewAt(wordId: string): number | undefined;
}
