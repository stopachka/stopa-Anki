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

export type ReviewRecord = {
  id: string;
  ownerId: string;
  wordId: string;
  book: number;
  rating: number;
  reviewedAt: number;
  log: StoredReviewLog;
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

function validateAnkiMetadata(value: unknown): void {
  if (value === undefined) return; // Cards saved before the Anki port have no metadata.
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved Anki metadata');
  const metadata = value as Record<string, unknown>;
  if (metadata.version !== 1) throw new Error('Unsupported saved Anki metadata version');
  if (typeof metadata.seedId !== 'string' || !/^\d{1,20}$/.test(metadata.seedId) || BigInt(metadata.seedId) > 0xffffffffffffffffn) {
    throw new Error('Invalid saved Anki seed ID');
  }
  for (const field of ['remainingSteps', 'scheduledSeconds']) {
    const number = metadata[field];
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 0 || number > 0xffffffff) throw new Error(`Invalid saved Anki ${field}`);
  }
  if (typeof metadata.easeFactor !== 'number' || !Number.isFinite(metadata.easeFactor) || metadata.easeFactor <= 0) throw new Error('Invalid saved Anki ease factor');
  if (metadata.dueDay !== undefined) {
    const day = metadata.dueDay;
    const parsed = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00.000Z`) : new Date(NaN);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) throw new Error('Invalid saved Anki due day');
  }
  if (metadata.leeched !== undefined && typeof metadata.leeched !== 'boolean') throw new Error('Invalid saved Anki leech flag');
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
  validateAnkiMetadata(card.anki);
  return { ...card, dueAt, lastReviewAt } as MemoryCard;
}

export function serializeReviewLog(log: ReviewLog): StoredReviewLog {
  if (log.shownAt !== undefined && (!Number.isFinite(log.shownAt) || log.shownAt < 0 || log.shownAt > log.reviewTime.getTime())) throw new Error('Invalid question show time');
  if (log.durationMs !== undefined && (!Number.isFinite(log.durationMs) || log.durationMs < 0)) throw new Error('Invalid review duration');
  return {
    ...log,
    dueAt: iso(log.dueAt, 'review due date'),
    lastReviewAt: log.lastReviewAt === null ? null : iso(log.lastReviewAt, 'previous review date'),
    reviewTime: iso(log.reviewTime, 'review time'),
  };
}
