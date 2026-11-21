// RWKV-P SM99 input formulas follow JSchoreels/anki-rwkv's integration manual
// and the Anki fork's FeatureState. Model identities are fixed random codes, not
// learned embeddings; this app uses a deterministic per-ID hash instead of the
// fork's first-seen PRNG. See public/models/rwkv/ for model provenance.
import type { FeatureCardState, ModelInput, RawFeatureInput, ReviewRecord, ScopeIds, WordIdentity } from './types.ts';

export type { ModelInput, RawFeatureInput, ReviewRecord, WordIdentity } from './types.ts';

const DAY_MS = 86_400_000;
const DAY_SECONDS = 86_400;
const CALENDAR_PERIODS = [3, 7, 30, 100, 365, 3650, 36500];
export const FEATURE_VERSION = 'sm99-utc-hash-v1';

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function logElapsed(value: number): number {
  // The first review contributes -1 to the cumulative sum as well. Preserve
  // this unusual sentinel convention: it is part of the training inputs.
  return value === -1 ? 0 : Math.log(1 + 1e-5 + value);
}

/** The deterministic, non-identity portion of the pretrained model input. */
export function deterministicFeatures(raw: RawFeatureInput): Float32Array {
  const features = new Float32Array(24);
  const elapsedPhase = 2 * Math.PI * modulo(raw.elapsedSeconds, DAY_SECONDS) / DAY_SECONDS;
  const cumulativePhase = 2 * Math.PI * modulo(raw.cumulativeSeconds, DAY_SECONDS) / DAY_SECONDS;
  features[0] = (logElapsed(raw.elapsedDays) - 1.51) / 1.62;
  features[1] = (logElapsed(raw.cumulativeDays) - 2.14) / 2.25;
  features[2] = (logElapsed(raw.elapsedSeconds) - 9.96) / 5.21;
  features[3] = Math.sin(elapsedPhase);
  features[4] = Math.cos(elapsedPhase);
  features[5] = (logElapsed(raw.cumulativeSeconds) - 10.86) / 5.80;
  features[6] = Math.sin(cumulativePhase);
  features[7] = Math.cos(cumulativePhase);
  // Missing historical duration is unknown, not a measured zero milliseconds.
  // The native runtime likewise encodes duration_millis=None as normalized 0.
  features[8] = raw.isQuery || raw.durationMs === undefined ? 0 : (Math.log(10 + raw.durationMs) - 8.9) / 1.07;
  if (!raw.isQuery && raw.rating >= 1 && raw.rating <= 4) features[8 + raw.rating] = 1;
  // SM99 was trained without the future-deletion signal. 13..15 stay zero.
  features[16] = Math.log(Math.log(Math.E + raw.daysSinceAnyReview));
  features[17] = (modulo(raw.dayOffset, 7) - 3) / 3;
  features[18] = (Math.log(3 + raw.newCardsSinceLastReview) - 2.945) / 2.011;
  features[19] = (Math.log(3 + raw.reviewsSinceLastReview) - 4.64) / 2.59;
  features[20] = (Math.log(3 + raw.newCardsToday) - 2.55) / 1.41;
  features[21] = (Math.log(3 + raw.reviewsToday) - 4.59) / 1.30;
  // Unlike the Small models, Big SM99 uses state on committed answer rows.
  features[22] = raw.isQuery ? 0 : raw.state - 2;
  features[23] = raw.isQuery ? 1 : 0;
  if (features.some(value => !Number.isFinite(value))) throw new Error('Invalid RWKV feature values.');
  return features;
}

function entityCode(key: string, length: number): Float32Array {
  let seed = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    seed = Math.imul(seed ^ key.charCodeAt(index), 16777619) >>> 0;
  }
  if (seed === 0) seed = 0x9e3779b9;
  const code = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    code[index] = (seed & 3) - 1.5;
  }
  return code;
}

function validTimestamp(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 8.64e15;
}

function validateWord(word: WordIdentity): void {
  if (typeof word.id !== 'string' || !word.id || !Number.isSafeInteger(word.book) || word.book <= 0 || word.book > 0xffffffff) {
    throw new Error('Invalid RWKV word identity.');
  }
}

function validateReview(event: ReviewRecord): void {
  validateWord({ id: event.wordId, book: event.book });
  if (typeof event.id !== 'string' || !event.id || typeof event.ownerId !== 'string' || !event.ownerId ||
      !validTimestamp(event.reviewedAt) || ![1, 2, 3, 4].includes(event.rating) ||
      !event.log || ![0, 1, 2, 3].includes(event.log.state) || event.log.rating !== event.rating ||
      String(event.log.cardId) !== event.wordId) throw new Error('Invalid saved review for RWKV.');
  if (event.log.durationMs !== undefined && (!Number.isFinite(event.log.durationMs) || event.log.durationMs < 0)) {
    throw new Error('Invalid saved review duration for RWKV.');
  }
  if (event.log.shownAt !== undefined && (!validTimestamp(event.log.shownAt) || event.log.shownAt > event.reviewedAt)) {
    throw new Error('Invalid saved review show time for RWKV.');
  }
}

/** Includes every field that can affect the model; order is device-independent. */
export function reviewSignature(event: ReviewRecord): string {
  return JSON.stringify([event.id, event.ownerId, event.wordId, event.book, event.rating,
    event.reviewedAt, event.log.state, event.log.durationMs ?? null, event.log.shownAt ?? null]);
}

/** Reject corrupt/mixed-owner logs instead of silently dropping existing work. */
export function canonicalizeReviews(records: readonly ReviewRecord[]): ReviewRecord[] {
  const byId = new Map<string, ReviewRecord>();
  let owner: string | undefined;
  for (const event of records) {
    validateReview(event);
    owner ??= event.ownerId;
    if (event.ownerId !== owner) throw new Error('RWKV history belongs to more than one account.');
    const previous = byId.get(event.id);
    if (previous && reviewSignature(previous) !== reviewSignature(event)) throw new Error('Conflicting saved review records.');
    byId.set(event.id, event);
  }
  return [...byId.values()].sort((a, b) => a.reviewedAt - b.reviewedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Only confirmed reviews advance counters. Queries are pure, including queries
 * for a never-studied card. Register the union of vocabulary and historical IDs
 * before replay so identical history always produces the same numeric scopes.
 *
 * Calendar features use UTC days for reproducible cross-device replay. This
 * clock is independent of the local 4am new-card allowance in daily-limit.ts.
 */
export class FeatureHistory {
  private identities = new Map<string, number>();
  private codes = new Map<string, Float32Array>();
  private cards = new Map<string, FeatureCardState>();
  private seenEvents = new Set<string>();
  private ownerId: string | undefined;
  private firstDay: number | undefined;
  private previousDayOffset = 0;
  private today = -1;
  private todayReviews = 0;
  private todayNewCards = 0;
  private reviewIndex = 0;
  private latestReviewAt = 0;
  private latestEventId = '';

  constructor(words: readonly WordIdentity[] = []) {
    this.registerWords(words);
  }

  registerWords(words: readonly WordIdentity[]): void {
    if (this.reviewIndex !== 0) throw new Error('Register RWKV words before replaying reviews.');
    const ids = new Set(this.identities.keys());
    for (const word of words) {
      validateWord(word);
      ids.add(word.id);
      this.codes.set(`card:${word.id}`, entityCode(`card:${word.id}`, 12));
      this.codes.set(`note:${word.id}`, entityCode(`note:${word.id}`, 12));
      this.codes.set(`deck:${word.book}`, entityCode(`deck:${word.book}`, 8));
    }
    this.identities = new Map([...ids].sort().map((id, index) => [id, index + 1]));
    this.codes.set('preset:1', entityCode('preset:1', 8));
  }

  reviewedWordIds(): string[] {
    return [...this.cards.keys()];
  }

  lastReviewAt(wordId: string): number | undefined {
    return this.cards.get(wordId)?.lastReviewAt;
  }

  query(word: WordIdentity, atMs: number, state = 2): ModelInput {
    if (!validTimestamp(atMs)) throw new Error('Invalid RWKV query time.');
    // A device clock behind another device's newest answer must not introduce
    // negative elapsed intervals or invalid log transforms.
    return this.build(word, Math.max(atMs, this.latestReviewAt), true, 0, state);
  }

  update(event: ReviewRecord): ModelInput {
    validateReview(event);
    if (this.ownerId !== undefined && this.ownerId !== event.ownerId) throw new Error('RWKV review belongs to another account.');
    if (this.seenEvents.has(event.id)) throw new Error('RWKV review has already been applied.');
    if (event.reviewedAt < this.latestReviewAt || (event.reviewedAt === this.latestReviewAt && event.id < this.latestEventId)) {
      throw new Error('Replay RWKV reviews in chronological order.');
    }
    const word = { id: event.wordId, book: event.book };
    const input = this.build(word, event.reviewedAt, false, event.rating, event.log.state, event.log.durationMs);
    const previous = this.cards.get(word.id);
    const rawDay = Math.floor(event.reviewedAt / DAY_MS);
    const dayOffset = this.firstDay === undefined ? 0 : rawDay - this.firstDay;
    const elapsedSeconds = previous ? Math.floor(Math.max(0, event.reviewedAt - previous.lastReviewAt) / 1000) : -1;
    const elapsedDays = previous ? rawDay - Math.floor(previous.lastReviewAt / DAY_MS) : -1;
    if (this.today !== dayOffset) {
      this.today = dayOffset;
      this.todayReviews = 0;
      this.todayNewCards = 0;
    }
    this.todayReviews += 1;
    if (!previous) this.todayNewCards += 1;
    this.cards.set(word.id, {
      lastReviewAt: event.reviewedAt,
      firstDayOffset: previous?.firstDayOffset ?? dayOffset,
      cumulativeDays: (previous?.cumulativeDays ?? 0) + elapsedDays,
      cumulativeSeconds: (previous?.cumulativeSeconds ?? 0) + elapsedSeconds,
      lastReviewIndex: this.reviewIndex,
      lastNewCardCount: this.cards.size + (previous ? 0 : 1),
    });
    this.ownerId ??= event.ownerId;
    this.firstDay ??= rawDay;
    this.previousDayOffset = dayOffset;
    this.reviewIndex += 1;
    this.latestReviewAt = event.reviewedAt;
    this.latestEventId = event.id;
    this.seenEvents.add(event.id);
    return input;
  }

  private build(word: WordIdentity, atMs: number, isQuery: boolean, rating: number, state: number, durationMs?: number): ModelInput {
    validateWord(word);
    const numericId = this.identities.get(word.id);
    if (numericId === undefined) throw new Error('Register this word before using the RWKV model.');
    const previous = this.cards.get(word.id);
    const rawDay = Math.floor(atMs / DAY_MS);
    const dayOffset = this.firstDay === undefined ? 0 : rawDay - this.firstDay;
    const elapsedSeconds = previous ? Math.floor(Math.max(0, atMs - previous.lastReviewAt) / 1000) : -1;
    const elapsedDays = previous ? rawDay - Math.floor(previous.lastReviewAt / DAY_MS) : -1;
    const firstDayOffset = previous?.firstDayOffset ?? dayOffset;
    const raw: RawFeatureInput = {
      elapsedDays,
      elapsedSeconds,
      cumulativeDays: (previous?.cumulativeDays ?? 0) + elapsedDays,
      cumulativeSeconds: (previous?.cumulativeSeconds ?? 0) + elapsedSeconds,
      durationMs,
      rating,
      state,
      dayOffset,
      firstDayOffset,
      daysSinceAnyReview: dayOffset - this.previousDayOffset,
      newCardsSinceLastReview: previous ? this.cards.size - previous.lastNewCardCount : 0,
      reviewsSinceLastReview: previous ? Math.max(0, this.reviewIndex - previous.lastReviewIndex - 1) : 0,
      newCardsToday: (this.today === dayOffset ? this.todayNewCards : 0) + (previous ? 0 : 1),
      reviewsToday: this.today === dayOffset ? this.todayReviews : 0,
      isQuery,
    };
    const features = new Float32Array(92);
    features.set(deterministicFeatures(raw));
    let offset = 24;
    for (const key of [`card:${word.id}`, `note:${word.id}`, `deck:${word.book}`, 'preset:1']) {
      const code = this.codes.get(key);
      if (!code) throw new Error('Register this deck before using the RWKV model.');
      features.set(code, offset);
      offset += code.length;
    }
    for (const period of CALENDAR_PERIODS) {
      const phase = 2 * Math.PI / period;
      features[offset++] = Math.sin(phase * modulo(dayOffset, period));
      features[offset++] = Math.cos(phase * modulo(dayOffset, period));
      features[offset++] = Math.sin(phase * modulo(firstDayOffset, period));
      features[offset++] = Math.cos(phase * modulo(firstDayOffset, period));
    }
    const ids: ScopeIds = [numericId, word.book, numericId, 1, 1];
    return { features, ids };
  }
}
