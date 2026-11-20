// State numbers are kept compatible with existing saved ts-fsrs cards.
export const State = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;
export type State = typeof State[keyof typeof State];
export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;
export type Grade = typeof Rating[keyof typeof Rating];

export type AnkiMetadata = {
  version: 1;
  seedId: string;
  remainingSteps: number;
  scheduledSeconds: number;
  easeFactor: number;
  dueDay?: string;
  leeched?: boolean;
};

// The original fields remain intact so upgrades never reset existing progress.
export interface MemoryCard {
  cardId: string | number;
  dueAt: Date;
  lastReviewAt: Date | null;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  scheduledDays: number;
  state: State;
  scheduleStatus: 'new' | 'learning' | 'review';
  learningStep?: number;
  anki?: AnkiMetadata;
}

export interface ReviewLog {
  cardId: string | number;
  dueAt: Date;
  lastReviewAt: Date | null;
  reviewTime: Date;
  stability: number;
  difficulty: number;
  rating: Grade;
  state: State;
  scheduleStatus: 'new' | 'learning' | 'review';
  scheduledDays: number;
  learningStep?: number;
}

export type ReviewInterval = { kind: 'seconds'; value: number } | { kind: 'days'; value: number };
export type ReviewResult = { card: MemoryCard; revlog: ReviewLog; interval: ReviewInterval };
