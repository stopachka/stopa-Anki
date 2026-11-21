import { canonicalizeReviews, FeatureHistory, reviewSignature } from './features.ts';
import type { ReviewRecord, ScopeIds, WordIdentity } from './types.ts';

export interface ModelEngine {
  evaluate(features: Float32Array, ids: ScopeIds, commit: boolean): { recall: number; ratings: readonly number[] };
  reset(): void;
}

/** Derived state is disposable: the canonical, synced review log is authoritative. */
export class RwkvController {
  private runtime: ModelEngine;
  private features: FeatureHistory | undefined;
  private catalog = '';
  private applied: string[] = [];
  private ready = false;

  constructor(runtime: ModelEngine) { this.runtime = runtime; }

  sync(words: readonly WordIdentity[], records: readonly ReviewRecord[]): { reviews: number } {
    // Invalidate before validation, too: a rejected snapshot must not leave an
    // old account/history available to a queued or subsequent rank request.
    const wasReady = this.ready;
    this.ready = false;
    const reviews = canonicalizeReviews(records);
    // Include historic/deleted words, since their answers affected shared streams.
    const registry = new Map<string, WordIdentity>();
    for (const word of [...words, ...reviews.map(review => ({ id: review.wordId, book: review.book }))]) {
      const existing = registry.get(word.id);
      if (existing && existing.book !== word.book) throw new Error('A saved review refers to a different book.');
      registry.set(word.id, { id: word.id, book: word.book });
    }
    const registered = [...registry.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const catalog = JSON.stringify(registered);
    const keys = reviews.map(reviewSignature);
    const isAppend = wasReady && this.catalog === catalog && keys.length >= this.applied.length &&
      this.applied.every((key, index) => key === keys[index]);
    if (!isAppend) {
      this.runtime.reset();
      this.features = new FeatureHistory(registered);
      this.applied = [];
      this.catalog = catalog;
    }
    try {
      for (let i = this.applied.length; i < reviews.length; i++) {
        const input = this.features!.update(reviews[i]);
        this.check(this.runtime.evaluate(input.features, input.ids, true));
      }
      this.applied = keys;
      this.ready = true;
      return { reviews: reviews.length };
    } catch (error) {
      // A partially applied replay must never be mistaken for a committed prefix.
      this.runtime.reset();
      this.applied = [];
      this.features = undefined;
      throw error;
    }
  }

  rank(words: readonly WordIdentity[], now: number): Array<{ id: string; recall: number }> {
    if (!this.ready || !this.features) throw new Error('Your review history is still loading.');
    if (!Number.isFinite(now)) throw new Error('The current study time is invalid.');
    return words.map(word => {
      const input = this.features!.query(word, now);
      const prediction = this.runtime.evaluate(input.features, input.ids, false);
      this.check(prediction);
      return { id: word.id, recall: prediction.recall };
    }).sort((a, b) => a.recall - b.recall || a.id.localeCompare(b.id));
  }

  private check(prediction: { recall: number; ratings: readonly number[] }): void {
    if (!Number.isFinite(prediction.recall) || prediction.recall < 0 || prediction.recall > 1 ||
      prediction.ratings.length !== 4 || prediction.ratings.some(p => !Number.isFinite(p) || p < 0 || p > 1)) {
      throw new Error('The study model returned an invalid prediction. Please try again.');
    }
  }
}
