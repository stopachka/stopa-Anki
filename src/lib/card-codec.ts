import type { MemoryCard, ReviewLog } from './scheduler.ts';

export type StoredCard = Omit<MemoryCard, 'dueAt' | 'lastReviewAt'> & {
  dueAt: string;
  lastReviewAt: string | null;
};

export type StoredReviewLog = Omit<ReviewLog, 'dueAt' | 'lastReviewAt' | 'reviewTime'> & {
  dueAt: string;
  lastReviewAt: string | null;
  reviewTime: string;
};

function iso(date: Date, field: string): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error(`Invalid ${field}`);
  return date.toISOString();
}

function reviveDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) throw new Error(`Invalid saved ${field}`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid saved ${field}`);
  return date;
}

export function serializeCard(card: MemoryCard): StoredCard {
  const stored: StoredCard = {
    ...card,
    dueAt: iso(card.dueAt, 'due date'),
    lastReviewAt: card.lastReviewAt === null ? null : iso(card.lastReviewAt, 'last review date'),
  };
  // Validate before saving so an invalid card cannot replace good server state.
  deserializeCard(stored);
  return stored;
}

export function deserializeCard(value: unknown): MemoryCard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved card');
  const card = value as Record<string, unknown>;
  const dueAt = reviveDate(card.dueAt, 'due date');
  const lastReviewAt = card.lastReviewAt === null ? null : reviveDate(card.lastReviewAt, 'last review date');
  for (const field of ['stability', 'difficulty', 'reps', 'lapses', 'scheduledDays']) {
    if (typeof card[field] !== 'number' || !Number.isFinite(card[field]) || card[field] < 0) throw new Error(`Invalid saved ${field}`);
  }
  for (const field of ['reps', 'lapses', 'scheduledDays']) {
    if (!Number.isInteger(card[field])) throw new Error(`Invalid saved ${field}`);
  }
  if (![0, 1, 2, 3].includes(card.state as number)) throw new Error('Invalid saved card state');
  if (!['new', 'learning', 'review'].includes(card.scheduleStatus as string)) throw new Error('Invalid saved schedule status');
  if (typeof card.cardId !== 'string' && typeof card.cardId !== 'number') throw new Error('Invalid saved card ID');
  if (card.learningStep !== undefined && (!Number.isInteger(card.learningStep) || (card.learningStep as number) < 0)) throw new Error('Invalid saved learning step');
  return { ...card, dueAt, lastReviewAt } as MemoryCard;
}

export function serializeReviewLog(log: ReviewLog): StoredReviewLog {
  return {
    ...log,
    dueAt: iso(log.dueAt, 'review due date'),
    lastReviewAt: log.lastReviewAt === null ? null : iso(log.lastReviewAt, 'previous review date'),
    reviewTime: iso(log.reviewTime, 'review time'),
  };
}
