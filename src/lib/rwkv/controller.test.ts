import test from 'node:test';
import assert from 'node:assert/strict';
import { RwkvController, type ModelEngine } from './controller.ts';
import type { ReviewRecord, ScopeIds } from './types.ts';

const words = [{ id: 'one', book: 1 }, { id: 'two', book: 2 }];
const base = Date.UTC(2026, 9, 1);
function event(id: string, at: number, word = 'one', ownerId = 'qa'): ReviewRecord {
  return {
    id, ownerId, wordId: word, book: word === 'one' ? 1 : 2, rating: 3, reviewedAt: base + at,
    log: { cardId: word, dueAt: new Date(base + at).toISOString(), lastReviewAt: null,
      reviewTime: new Date(base + at).toISOString(), stability: 0, difficulty: 0, rating: 3,
      state: 2, scheduleStatus: 'review', scheduledDays: 0, durationMs: 5000 },
  };
}

class RecordingEngine implements ModelEngine {
  resets = 0;
  updates: Float32Array[] = [];
  fail = false;
  evaluate(features: Float32Array, _ids: ScopeIds, commit: boolean) {
    if (this.fail) throw new Error('interrupted');
    if (commit) this.updates.push(features.slice());
    return { recall: 0.8, ratings: [0.2, 0.1, 0.6, 0.1] };
  }
  reset() { this.resets++; this.updates = []; }
}

test('live-query echoes and appended reviews are each committed exactly once', () => {
  const runtime = new RecordingEngine();
  const model = new RwkvController(runtime);
  const first = event('first', 0);
  assert.deepEqual(model.sync(words, [first]), { reviews: 1 });
  model.sync(words, [first, first]);
  assert.equal(runtime.updates.length, 1);
  model.sync(words, [first, event('second', 100_000, 'two')]);
  assert.equal(runtime.resets, 1);
  assert.equal(runtime.updates.length, 2);
});

test('a late review from another device rebuilds in chronological order', () => {
  const runtime = new RecordingEngine();
  const model = new RwkvController(runtime);
  const first = event('first', 0), last = event('last', 200_000), late = event('late', 100_000, 'two');
  model.sync(words, [first, last]);
  model.sync(words, [last, late, first]);
  const fresh = new RecordingEngine();
  new RwkvController(fresh).sync(words, [first, late, last]);
  assert.equal(runtime.resets, 2);
  assert.deepEqual(runtime.updates, fresh.updates);
});

test('history rollback or edited metadata cannot reuse stale recurrent state', () => {
  const runtime = new RecordingEngine();
  const model = new RwkvController(runtime);
  const first = event('first', 0), second = event('second', 100_000);
  model.sync(words, [first, second]);
  model.sync(words, [first]);
  assert.equal(runtime.updates.length, 1);
  model.sync(words, [{ ...first, log: { ...first.log, durationMs: 15_000 } }]);
  assert.equal(runtime.resets, 3);
});

test('querying repeatedly does not commit model or feature history', () => {
  const runtime = new RecordingEngine();
  const model = new RwkvController(runtime);
  const first = event('first', 0);
  model.sync(words, [first]);
  assert.deepEqual(model.rank(words, base + 1000), model.rank(words, base + 1000));
  assert.equal(runtime.updates.length, 1);
  model.sync(words, [first]);
  assert.equal(runtime.resets, 1);
});

test('failed updates invalidate partial replay and the next sync rebuilds', () => {
  const runtime = new RecordingEngine();
  const model = new RwkvController(runtime);
  const first = event('first', 0), second = event('second', 100_000);
  model.sync(words, [first]);
  runtime.fail = true;
  assert.throws(() => model.sync(words, [first, second]), /interrupted/);
  assert.throws(() => model.rank(words, base), /still loading/);
  runtime.fail = false;
  model.sync(words, [first, second]);
  assert.equal(runtime.updates.length, 2);
});

test('different owners cannot share a committed prefix or mixed history', () => {
  const runtime = new RecordingEngine();
  const model = new RwkvController(runtime);
  model.sync(words, [event('first', 0)]);
  model.sync(words, [event('first', 0, 'one', 'another')]);
  assert.equal(runtime.resets, 2);
  assert.throws(() => model.sync(words, [event('first', 0), event('other', 1000, 'two', 'another')]), /more than one account/);
});

test('historic words missing from the current book files still affect shared state', () => {
  const runtime = new RecordingEngine();
  const model = new RwkvController(runtime);
  model.sync(words.slice(0, 1), [event('first', 0, 'two')]);
  assert.equal(runtime.updates.length, 1);
  assert.equal(model.rank(words.slice(0, 1), base + 1000).length, 1);
});

test('preflight validation failures invalidate old predictions and require a clean replay', () => {
  const runtime = new RecordingEngine();
  const model = new RwkvController(runtime);
  const first = event('first', 0);
  model.sync(words, [first]);
  assert.throws(() => model.sync(words, [{ ...first, rating: 5 }]), /Invalid saved review/);
  assert.throws(() => model.rank(words, base + 1000), /still loading/);
  model.sync(words, [first]);
  assert.equal(runtime.resets, 2);
  assert.equal(runtime.updates.length, 1);

  assert.throws(() => model.sync([{ ...words[0], book: 2 }], [first]), /different book/);
  assert.throws(() => model.rank(words, base + 1000), /still loading/);
  model.sync(words, [first]);
  assert.equal(runtime.resets, 3);
  assert.equal(model.rank(words, base + 1000).length, 2);
});
