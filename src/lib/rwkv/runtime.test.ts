import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRwkvRuntime } from './runtime.ts';
import { RwkvController } from './controller.ts';
import type { ReviewRecord, WordIdentity } from './types.ts';

type Prediction = { recall: number; ratings: readonly number[] };
type Row = {
  features: number[];
  ids: [number, number, number, number, number];
  skip: boolean;
  expected: Record<'0' | '8', Prediction>;
};
type Fixture = {
  provenance: { weightsSha256: string; tolerance: number };
  users: { user: number; rows: Row[] }[];
};

const fixture: Fixture = JSON.parse(await readFile(new URL('./__fixtures__/big-sm99-reference.json', import.meta.url), 'utf8'));
const [weightsBytes, wasmBytes] = await Promise.all([
  readFile(new URL('../../../public/models/rwkv/big-sm99-682ba1ff.weights.bin', import.meta.url)),
  readFile(new URL('../../../public/models/rwkv/runtime-v1.wasm', import.meta.url)),
]);

function compare(actual: Prediction, expected: Prediction, context: string, tolerance = fixture.provenance.tolerance) {
  assert.equal(actual.ratings.length, 4, `${context}: four rating probabilities`);
  const pairs = [
    ['recall', actual.recall, expected.recall],
    ...actual.ratings.map((value, index) => [`rating ${index + 1}`, value, expected.ratings[index]]),
  ] as [string, number, number][];
  for (const [name, got, want] of pairs) {
    assert.ok(Number.isFinite(got), `${context} ${name} is finite`);
    assert.ok(Math.abs(got - want) <= tolerance,
      `${context} ${name}: ${got} vs ${want} (difference ${Math.abs(got - want)}, tolerance ${tolerance})`);
  }
  assert.ok(Math.abs(actual.ratings.reduce((sum, value) => sum + value, 0) - 1) < 1e-5,
    `${context}: rating distribution sums to one`);
}

test('bundled Big SM99 weights are the exact published checkpoint export', () => {
  assert.equal(createHash('sha256').update(weightsBytes).digest('hex'), fixture.provenance.weightsSha256);
  assert.equal(weightsBytes.byteLength, 11_082_637);
});

for (const stateBits of [0] as const) {
  test('WASM Big SM99 matches independent NumPy reference with production FP32 state', async () => {
    const runtime = await createRwkvRuntime({ wasmBytes, weightsBytes, stateBits });
    try {
      for (const user of fixture.users) {
        runtime.clear();
        for (const [index, row] of user.rows.entries()) {
          const actual = runtime.step(new Float32Array(row.features), row.ids, row.skip);
          compare(actual, row.expected[String(stateBits) as '0' | '8'], `user ${user.user}, row ${index}`);
        }
      }
    } finally {
      runtime.dispose();
    }
  });
}

test('queries do not change state, including new entities; clear reproduces a cold start', async () => {
  const baseline = await createRwkvRuntime({ wasmBytes, weightsBytes, stateBits: 8 });
  const queried = await createRwkvRuntime({ wasmBytes, weightsBytes, stateBits: 8 });
  const rows = fixture.users[0].rows;
  try {
    for (const [index, row] of rows.slice(0, 96).entries()) {
      const features = new Float32Array(row.features);
      const initialQuery = queried.step(features, row.ids, true);
      compare(queried.step(features, row.ids, true), initialQuery, `repeat query ${index}`, 0);
      queried.step(features, [999_999, 999_999, 999_999, 999_999, 999_999], true);
      compare(queried.step(features, row.ids, row.skip), baseline.step(features, row.ids, row.skip),
        `answer unaffected by speculative queries ${index}`, 0);
    }
    queried.clear();
    const first = rows[0];
    compare(queried.step(new Float32Array(first.features), first.ids, first.skip), first.expected['8'], 'reset');
  } finally {
    baseline.dispose();
    queried.dispose();
  }
});

test('real review replay, incremental sync and ranking match independent NumPy predictions', async () => {
  const reference: {
    words: WordIdentity[];
    records: ReviewRecord[];
    steps: { name: string; history: string[]; queryAt: number; expected: { id: string; recall: number }[] }[];
  } = JSON.parse(await readFile(new URL('./__fixtures__/controller-reference.json', import.meta.url), 'utf8'));
  // Exercise the production default precision, not a test-only override.
  const runtime = await createRwkvRuntime({ wasmBytes, weightsBytes });
  const controller = new RwkvController(runtime);
  const records = new Map(reference.records.map(record => [record.id, record]));
  try {
    for (const step of reference.steps) {
      controller.sync(reference.words, step.history.map(id => records.get(id)!));
      const actual = controller.rank(reference.words, step.queryAt);
      assert.deepEqual(actual.map(prediction => prediction.id), step.expected.map(prediction => prediction.id), `${step.name}: ordering`);
      for (const [index, prediction] of actual.entries()) {
        assert.ok(Math.abs(prediction.recall - step.expected[index].recall) < 1e-5,
          `${step.name}: ${prediction.id}: ${prediction.recall} vs ${step.expected[index].recall}`);
      }
      assert.deepEqual(controller.rank(reference.words, step.queryAt), actual, `${step.name}: query does not change state`);
    }
  } finally {
    runtime.dispose();
  }
});
