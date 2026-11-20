// Cases translated from Anki 26.09.4; SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { LearningSteps } from './steps.ts';

test('Anki learning-step delays retain the current step for Hard after the first step', () => {
  const cases: [number[], number, number, number, number | undefined][] = [
    [[10], 1, 600, 900, undefined],
    [[3 * 1440], 1, 3 * 86400, 4 * 86400, undefined],
    [[1, 10], 2, 60, 330, 600],
    [[1, 10], 1, 60, 600, undefined],
    [[1, 10, 100], 3, 60, 330, 600],
    [[1, 10, 100], 2, 60, 600, 6000],
    [[1, 10, 100], 1, 60, 6000, undefined],
  ];
  for (const [minutes, remaining, again, hard, good] of cases) {
    const steps = new LearningSteps(minutes);
    assert.equal(steps.againDelaySeconds(), again);
    assert.equal(steps.hardDelaySeconds(remaining), hard);
    assert.equal(steps.goodDelaySeconds(remaining), good);
  }
});

test('Anki step counters strip learning-today digits and safely handle changed/empty steps', () => {
  const steps = new LearningSteps([1, 10]);
  assert.equal(steps.hardDelaySeconds(1001), 600);
  assert.equal(steps.hardDelaySeconds(99), 330);
  assert.equal(steps.remainingForGood(2), 1);
  assert.equal(steps.remainingForGood(1), 0);
  assert.equal(steps.remainingForFailed(), 2);
  assert.equal(steps.currentDelaySeconds(1), 600);
  const empty = new LearningSteps([]);
  assert.equal(empty.againDelaySeconds(), undefined);
  assert.equal(empty.hardDelaySeconds(1), undefined);
  assert.equal(empty.goodDelaySeconds(1), undefined);
  assert.equal(empty.currentDelaySeconds(1), 0);
  assert.equal(empty.remainingForGood(1), 0);
  assert.equal(empty.isEmpty(), true);
});

test('Hard rounds learning intervals beyond one day to whole days', () => {
  assert.equal(new LearningSteps([1440]).hardDelaySeconds(1), 2 * 86400);
  assert.equal(new LearningSteps([0.01]).againDelaySeconds(), 0);
});
