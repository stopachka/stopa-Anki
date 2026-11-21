import type { Word } from '../../types.ts';
import type { ReviewRecord } from './types.ts';

export type RecallScore = { id: string; recall: number };
export type SyncResult = { reviews: number };

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** One worker per signed-in account. Inference stays local; Instant syncs the review log separately. */
export class RwkvClient {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private requestId = 0;
  private closed = false;

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'stopa-rwkv-big' });
    this.worker.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const request = this.pending.get(event.data.id);
      if (!request) return;
      this.pending.delete(event.data.id);
      clearTimeout(request.timer);
      if (event.data.error) request.reject(new Error(event.data.error));
      else request.resolve(event.data.result);
    };
    this.worker.onerror = event => {
      event.preventDefault();
      this.fail(new Error('The study model stopped. Please try again.'));
    };
    this.worker.onmessageerror = () => this.fail(new Error('Couldn’t read the study model’s response. Please try again.'));
  }

  sync(words: Word[], reviews: ReviewRecord[]): Promise<SyncResult> {
    return this.request('sync', { words, reviews });
  }

  rank(words: Word[], now: number): Promise<RecallScore[]> {
    return this.request('rank', { words, now });
  }

  dispose(): void {
    this.fail(new Error('The study model was closed.'));
  }

  private request<T>(kind: 'sync' | 'rank', payload: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error('The study model was closed. Please try again.'));
    const id = ++this.requestId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('Loading the study model took too long. Please check your connection and try again.')), 180_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { this.worker.postMessage({ id, kind, ...payload as object }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}
