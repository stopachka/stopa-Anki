import test from 'node:test';
import assert from 'node:assert/strict';
import { ankiNextDayAt, elapsedStudyDays, fsrsElapsedDays, reviewDueDate, studyDayBounds, studyDayKey } from './time.ts';
import { makeAnkiScheduler } from './scheduler.ts';

test('Anki study days start at 4am and keep late-night study in the previous day', () => {
  assert.equal(studyDayKey(new Date(2026, 10, 20, 3, 59, 59)), '2026-11-19');
  assert.equal(studyDayKey(new Date(2026, 10, 20, 4)), '2026-11-20');
  assert.equal(elapsedStudyDays(new Date(2026, 10, 19, 23), new Date(2026, 10, 20, 3)), 0);
  assert.equal(elapsedStudyDays(new Date(2026, 10, 19, 23), new Date(2026, 10, 20, 4)), 1);
  assert.equal(reviewDueDate(new Date(2026, 10, 20, 2), 1).getTime(), new Date(2026, 10, 20, 4).getTime());
});

test('local day deadlines and ranges preserve 4am through daylight-saving changes', () => {
  const previousTZ = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const spring = studyDayBounds(new Date(2026, 2, 7, 12));
    const autumn = studyDayBounds(new Date(2026, 9, 31, 12));
    assert.equal((spring.end - spring.start) / 3_600_000, 23);
    assert.equal((autumn.end - autumn.start) / 3_600_000, 25);
    for (const bounds of [spring, autumn]) {
      assert.equal(new Date(bounds.start).getHours(), 4);
      assert.equal(new Date(bounds.end).getHours(), 4);
    }
    const due = reviewDueDate(new Date(2026, 2, 7, 12), 2);
    assert.equal(due.getDate(), 9);
    assert.equal(due.getHours(), 4);
    assert.equal(elapsedStudyDays(new Date(2026, 2, 7, 23), new Date(2026, 2, 8, 5)), 1);
  } finally {
    if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ;
  }
});

test('FSRS uses Anki next-day cutoff elapsed days, not a calendar-day subtraction', () => {
  const previousTZ = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const now = new Date(2026, 2, 8, 12);
    const previous = new Date(2026, 2, 7, 4, 30);
    assert.equal(elapsedStudyDays(previous, now), 1);
    assert.equal(fsrsElapsedDays(previous, now), 1);
    // Across spring DST, Anki's cutoff-minus-review calculation can differ
    // from merely counting calendar boundaries for a very early prior answer.
    assert.equal(fsrsElapsedDays(new Date(2026, 2, 7, 3, 30), now), 1);
    assert.equal(elapsedStudyDays(new Date(2026, 2, 7, 3, 30), now), 2);
    const beforeJump = new Date(2026, 2, 8, 1);
    assert.equal(ankiNextDayAt(beforeJump), Date.UTC(2026, 2, 8, 12));
    assert.equal(fsrsElapsedDays(new Date(now.getTime() + 86_400_000), now), 0);
  } finally {
    if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ;
  }
});

test('FSRS truncates review milliseconds to Anki TimestampSecs at a day boundary', () => {
  const previous = new Date(2026, 10, 19, 4, 0, 0, 999);
  const now = new Date(2026, 10, 19, 4, 1);
  assert.equal(fsrsElapsedDays(previous, now), 1);
  assert.equal(fsrsElapsedDays(new Date(2026, 10, 19, 4, 0, 1), now), 0);
  assert.equal(previous.getMilliseconds(), 999);
});

test('learning interval classification uses Anki fixed-offset rollover near DST', () => {
  const previousTZ = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const scheduler = makeAnkiScheduler({ learningSteps: [90], enableFuzz: false });
    const springNow = new Date('2026-03-08T01:30:00-08:00');
    const spring = scheduler.review({ card: scheduler.newCard({ now: springNow }), grade: 1, now: springNow });
    assert.deepEqual(spring.interval, { kind: 'seconds', value: 5400 });
    assert.equal(spring.card.anki?.dueDay, undefined);
    assert.equal(spring.card.dueAt.toISOString(), '2026-03-08T11:00:00.000Z');

    // Before the autumn clock change, the fixed-offset cutoff falls at 3am
    // after the change, an hour earlier than the local calendar cutoff.
    const autumnScheduler = makeAnkiScheduler({ learningSteps: [150], enableFuzz: false });
    const autumnNow = new Date('2026-11-01T01:30:00-07:00');
    const autumn = autumnScheduler.review({ card: autumnScheduler.newCard({ now: autumnNow }), grade: 1, now: autumnNow });
    assert.deepEqual(autumn.interval, { kind: 'days', value: 1 });
    assert.equal(autumn.card.anki?.dueDay, '2026-11-01');
    assert.equal(autumn.card.dueAt.toISOString(), '2026-11-01T12:00:00.000Z');
  } finally {
    if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ;
  }
});
