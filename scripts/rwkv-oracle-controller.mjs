// Capture the app's feature/controller inputs for independent NumPy prediction.
// Called by rwkv-oracle-controller.py; prints synthetic data only.
import { RwkvController } from '../src/lib/rwkv/controller.ts';

const words = [
  { id: 'book-1-ni', book: 1 }, { id: 'book-1-hao', book: 1 },
  { id: 'book-2-xue', book: 2 }, { id: 'book-3-sheng', book: 3 },
  { id: 'book-3-unseen', book: 3 },
];
const base = Date.UTC(2026, 10, 1, 16);
const day = 86_400_000;
const specifications = [
  [0, 0, 3, 0, undefined], [1, 60_000, 1, 0, 8_000],
  [0, 620_000, 3, 1, 4_500], [1, 700_000, 3, 1, 7_000],
  [2, day, 4, 0, 2_000], [3, day + 100_000, 3, 0, 5_000],
  [0, 2 * day, 3, 2, 3_000], [1, 2 * day + 100_000, 2, 2, 9_000],
  [2, 7 * day, 3, 2, 4_000], [3, 7 * day + 200_000, 1, 2, 15_000],
  [3, 7 * day + 260_000, 3, 3, 5_000], [0, 14 * day, 4, 2, 2_000],
  [2, 3 * day, 2, 2, 11_000], // A review arriving late from another device.
];
const records = specifications.map(([wordIndex, offset, rating, state, durationMs], index) => {
  const word = words[wordIndex];
  const reviewedAt = base + offset;
  const iso = new Date(reviewedAt).toISOString();
  return {
    id: `synthetic-${String(index).padStart(2, '0')}`, ownerId: 'synthetic-oracle',
    wordId: word.id, book: word.book, rating, reviewedAt,
    log: { cardId: word.id, dueAt: iso, lastReviewAt: null, reviewTime: iso,
      stability: 0, difficulty: 0, rating, state, scheduleStatus: 'review', scheduledDays: 0,
      ...(durationMs === undefined ? {} : { durationMs, shownAt: reviewedAt - durationMs }) },
  };
});
const steps = [
  { name: 'initial replay', history: records.slice(0, 8).map(r => r.id), queryAt: base + 3 * day },
  { name: 'append four reviews', history: records.slice(0, 12).map(r => r.id), queryAt: base + 16 * day },
  { name: 'duplicate echo and repeat query', history: [...records.slice(0, 12).reverse(), records[0]].map(r => r.id), queryAt: base + 16 * day },
  { name: 'late review rebuild', history: records.map(r => r.id), queryAt: base + 16 * day },
  { name: 'rollback rebuild', history: records.slice(0, 12).map(r => r.id), queryAt: base + 16 * day },
];
const operations = [];
let currentStep = 0;
let queryIndex = 0;
const controller = new RwkvController({
  reset() { operations.push({ kind: 'reset' }); },
  evaluate(features, ids, commit) {
    operations.push({ kind: 'evaluate', features: Array.from(features), ids: Array.from(ids), commit,
      ...(commit ? {} : { step: currentStep, wordId: words[queryIndex++].id }) });
    return { recall: 0.8, ratings: [0.2, 0.1, 0.6, 0.1] };
  },
});
steps.forEach((step, index) => {
  currentStep = index;
  queryIndex = 0;
  controller.sync(words, step.history.map(id => records.find(record => record.id === id)));
  controller.rank(words, step.queryAt);
});
process.stdout.write(JSON.stringify({ words, records, steps, operations }));
