import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeAnkiScheduler, type SchedulerOptions, type SchedulingState } from './scheduler.ts';
import type { Grade, MemoryCard } from './types.ts';
import { studyDayKey } from './time.ts';

type SerializedCard = Omit<MemoryCard, 'dueAt' | 'lastReviewAt' | 'anki'> & {
    dueAt: string;
    lastReviewAt: string | null;
    anki?: Omit<NonNullable<MemoryCard['anki']>, 'seedId' | 'version'> & { seedId?: string | number; version?: 1 };
};
type Fixture = {
  name: string;
  now: string;
  card: SerializedCard;
  options: SchedulerOptions;
  expected: Record<string, Record<string, number | boolean>>;
  appliedLearningSeconds?: Record<string, number>;
};
type ReviewSequence = {
  name: string;
  options: SchedulerOptions;
  initialCard: SerializedCard;
  steps: {
    now: string;
    rating: Grade;
    temporalRebase: { seconds: number; reviewDueDays: number };
    inputCard: SerializedCard;
    expectedState: Record<string, number | boolean>;
    expectedCard: SerializedCard;
  }[];
};
type Fixtures = { source: { timezone: string }; cases: Fixture[]; reviewSequenceCases?: ReviewSequence[] };
const referenceFiles = ['anki-reference.json', 'anki-fuzz-reference.json'];

function reviveCard(card: SerializedCard): MemoryCard {
  return {
    ...card,
    dueAt: new Date(card.dueAt),
    lastReviewAt: card.lastReviewAt ? new Date(card.lastReviewAt) : null,
    anki: card.anki ? { ...card.anki, version: 1, seedId: String(card.anki.seedId ?? 0) } : undefined,
  };
}

function assertState(actual: SchedulingState, expected: Record<string, number | boolean>, context: string) {
  for (const [field, value] of Object.entries(expected)) {
    const received = actual[field as keyof typeof actual];
    const label = `${context} ${field}: ${received} vs ${value}`;
    if (field === 'stability' || field === 'difficulty' || field === 'easeFactor') {
      assert.ok(Math.abs(Number(received) - Number(value)) <= Math.max(0.000002, Math.abs(Number(value)) * 0.000002), label);
    } else assert.equal(received, value, label);
  }
}

for (const filename of referenceFiles) {
  const fixtures: Fixtures = JSON.parse(fs.readFileSync(new URL(`../__fixtures__/${filename}`, import.meta.url), 'utf8'));
  test(`scheduling transitions match actual Anki 26.09.4: ${filename}`, () => {
    const previousTZ = process.env.TZ;
    process.env.TZ = fixtures.source.timezone;
    try {
      let outcomes = 0;
      for (const fixture of fixtures.cases) {
        const scheduler = makeAnkiScheduler(fixture.options);
        const card = reviveCard(fixture.card);
        const original = JSON.stringify(card);
        const now = new Date(fixture.now);
        const states = scheduler.schedulingStates(card, now);
        for (const [rating, expected] of Object.entries(fixture.expected)) {
          const grade = Number(rating) as Grade;
          const actual = states[grade];
          assertState(actual, expected, `${fixture.name} rating ${rating}`);
          const result = scheduler.review({ card, grade, now });
          assert.equal(result.card.state, actual.state, `${fixture.name}: applied state`);
          assert.equal(result.card.reps, card.reps + 1, `${fixture.name}: applied reps`);
          assert.equal(result.card.anki?.remainingSteps, actual.remainingSteps, `${fixture.name}: applied steps`);
          assert.equal(result.card.lastReviewAt?.getTime(), now.getTime());
          if (fixture.appliedLearningSeconds?.[rating] !== undefined) {
            const actualSeconds = result.card.dueAt.getTime() / 1000 - Math.floor(now.getTime() / 1000);
            assert.equal(actualSeconds, fixture.appliedLearningSeconds[rating], `${fixture.name} rating ${rating}: actual due jitter`);
          }
          if (result.interval.kind === 'days') {
            assert.equal(result.card.anki?.dueDay, studyDayKey(result.card.dueAt));
            assert.equal(result.card.dueAt.getHours(), 4);
          }
          assert.equal(result.revlog.state, card.state, `${fixture.name}: log stores previous state`);
          assert.equal(JSON.stringify(card), original, `${fixture.name}: input remains unchanged`);
          outcomes++;
        }
      }
      assert.equal(outcomes, fixtures.cases.length * 4);
    } finally {
      if (previousTZ === undefined) delete process.env.TZ;
      else process.env.TZ = previousTZ;
    }
  });

  for (const sequence of fixtures.reviewSequenceCases ?? []) {
    test(`persisted review sequence matches actual Anki: ${sequence.name}`, () => {
      const previousTZ = process.env.TZ;
      process.env.TZ = fixtures.source.timezone;
      try {
        const scheduler = makeAnkiScheduler(sequence.options);
        let card = reviveCard(sequence.initialCard);
        for (const [index, step] of sequence.steps.entries()) {
          const context = `${sequence.name} step ${index + 1} rating ${step.rating}`;
          // The real core uses wall-clock time. The oracle shifts its persisted
          // timestamps backward to simulate waiting; shift only our own dates,
          // carrying our previous memory, repetitions and metadata forward.
          const shift = step.temporalRebase;
          if (card.lastReviewAt) card.lastReviewAt = new Date(card.lastReviewAt.getTime() + shift.seconds * 1000);
          if (card.anki?.dueDay) {
            card.dueAt.setDate(card.dueAt.getDate() + shift.reviewDueDays);
            card.anki.dueDay = studyDayKey(card.dueAt);
          } else card.dueAt = new Date(card.dueAt.getTime() + shift.seconds * 1000);
          assert.deepEqual(JSON.parse(JSON.stringify(card)), step.inputCard, `${context}: persisted input`);
          const now = new Date(step.now);
          assertState(scheduler.schedulingStates(card, now)[step.rating], step.expectedState, context);
          const result = scheduler.review({ card, grade: step.rating, now });
          const persisted: SerializedCard = JSON.parse(JSON.stringify(result.card));
          // Exact comparison catches drift at Anki's persisted f32 rounding
          // boundaries, including stability, difficulty and ease factor.
          assert.deepEqual(persisted, step.expectedCard, `${context}: persisted output`);
          card = reviveCard(persisted);
        }
      } finally {
        if (previousTZ === undefined) delete process.env.TZ;
        else process.env.TZ = previousTZ;
      }
    });
  }
}
