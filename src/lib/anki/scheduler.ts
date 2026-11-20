// Copyright: Ankitects Pty Ltd and contributors.
// TypeScript adaptation: stopa-Anki contributors, 2026.
// SPDX-License-Identifier: AGPL-3.0-or-later
// Ported from Anki 26.09.4 rslib/src/scheduler/{states,answering}.
import { nextMemoryStates } from './fsrs.ts';
import { persistMemoryState } from './memory.ts';
import { LearningSteps } from './steps.ts';
import { getFuzzFactor, learningIntervalWithFuzz, minimumReviewFuzzInterval, withReviewFuzz } from './fuzz.ts';
import { ankiNextDayAt, fsrsElapsedDays, reviewDueDate, studyDayKey } from './time.ts';
import { Rating, State, type Grade, type MemoryCard, type ReviewInterval, type ReviewResult } from './types.ts';

export interface SchedulerOptions {
  desiredRetention?: number;
  learningSteps?: number[];
  relearningSteps?: number[];
  maximumInterval?: number;
  enableFuzz?: boolean;
}

export type SchedulingState = {
  state: State;
  remainingSteps: number;
  scheduledSeconds: number;
  scheduledDays: number;
  stability: number;
  difficulty: number;
  easeFactor: number;
  lapses: number;
  leeched: boolean;
};

// Existing vocabulary uses string IDs. Give each one a stable u64 Anki seed ID.
function seedIdFor(card: MemoryCard): string {
  if (card.anki?.seedId) return card.anki.seedId;
  if (/^\d+$/.test(String(card.cardId))) return BigInt.asUintN(64, BigInt(card.cardId)).toString();
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(String(card.cardId))) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  return hash.toString();
}

export function makeAnkiScheduler(options: SchedulerOptions = {}) {
  const retention = options.desiredRetention ?? 0.9;
  const learn = new LearningSteps(options.learningSteps ?? [1, 10]);
  const relearn = new LearningSteps(options.relearningSteps ?? [1]);
  const maximum = Math.max(1, Math.floor(options.maximumInterval ?? 36500));
  const enableFuzz = options.enableFuzz ?? true;

  const newCard = ({ cardId = '0', now = new Date() }: { cardId?: string | number; now?: Date } = {}): MemoryCard => ({
    cardId, dueAt: new Date(now), lastReviewAt: null,
    stability: 0, difficulty: 0, reps: 0, lapses: 0,
    scheduledDays: 0, state: State.New, scheduleStatus: 'new', learningStep: 0,
  });

  const schedulingStates = (card: MemoryCard, now: Date): Record<Grade, SchedulingState> => {
    const seed = BigInt.asUintN(64, BigInt(seedIdFor(card)) + BigInt(card.reps));
    const factor = enableFuzz ? getFuzzFactor(seed) : null;
    const memory = card.state === State.New ? null : { stability: card.stability, difficulty: card.difficulty };
    const elapsed = card.lastReviewAt ? fsrsElapsedDays(card.lastReviewAt, now) : 0;
    const fsrs = nextMemoryStates(memory, elapsed, retention);
    const ease = Math.fround(card.anki?.easeFactor ?? 2.5);
    const currentSteps = card.state === State.Relearning ? relearn : learn;
    const remaining = card.anki?.remainingSteps ?? Math.max(0, currentSteps.remainingForFailed() - (card.learningStep ?? 0));
    const fuzz = (interval: number, minimum = 1) => withReviewFuzz(interval, Math.min(maximum, Math.max(1, minimum)), maximum, factor);
    const results = {} as Record<Grade, SchedulingState>;

    for (const grade of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
      const model = fsrs[grade === Rating.Again ? 'again' : grade === Rating.Hard ? 'hard' : grade === Rating.Good ? 'good' : 'easy'];
      let result: SchedulingState = {
        state: State.Review, remainingSteps: 0, scheduledSeconds: 0,
        scheduledDays: card.scheduledDays, ...model.memory, easeFactor: ease,
        lapses: card.lapses, leeched: false,
      };

      if (card.state === State.Review) {
        if (grade === Rating.Again) {
          result.lapses++;
          result.leeched = result.lapses >= 8 && (result.lapses - 8) % 4 === 0;
          result.easeFactor = Math.max(Math.fround(ease + Math.fround(-0.2)), Math.fround(1.3));
          result.scheduledDays = Math.max(1, Math.round(model.interval));
          const delay = relearn.againDelaySeconds();
          if (delay !== undefined || (relearn.isEmpty() && model.interval < 0.5)) {
            result.state = State.Relearning;
            result.remainingSteps = relearn.remainingForFailed();
            result.scheduledSeconds = delay ?? Math.floor(Math.fround(model.interval * 86400));
          }
        } else {
          // Each passing interval is constrained by the one before it, as in
          // ReviewState::passing_fsrs_review_intervals (including maximum caps).
          const hard = fuzz(fsrs.hard.interval, minimumReviewFuzzInterval(fsrs.hard.interval, card.scheduledDays, maximum));
          const good = fuzz(fsrs.good.interval, Math.max(hard + 1, minimumReviewFuzzInterval(fsrs.good.interval, card.scheduledDays, maximum)));
          const easy = fuzz(fsrs.easy.interval, Math.max(good + 1, minimumReviewFuzzInterval(fsrs.easy.interval, card.scheduledDays, maximum)));
          result.scheduledDays = grade === Rating.Hard ? hard : grade === Rating.Good ? good : easy;
          if (grade === Rating.Hard) result.easeFactor = Math.max(Math.fround(ease + Math.fround(-0.15)), Math.fround(1.3));
          if (grade === Rating.Easy) result.easeFactor = Math.fround(ease + Math.fround(0.15));
        }
      } else {
        const isRelearning = card.state === State.Relearning;
        const steps = isRelearning ? relearn : learn;
        const left = card.state === State.New ? steps.remainingForFailed() : remaining;
        const delay = grade === Rating.Again ? steps.againDelaySeconds()
          : grade === Rating.Hard ? steps.hardDelaySeconds(left)
          : grade === Rating.Good ? steps.goodDelaySeconds(left) : undefined;
        const nextRemaining = grade === Rating.Again ? steps.remainingForFailed()
          : grade === Rating.Good ? steps.remainingForGood(left) : left;
        if (!isRelearning) { result.easeFactor = 2.5; result.lapses = 0; }
        if (grade !== Rating.Easy && (delay !== undefined || (steps.isEmpty() && model.interval < 0.5))) {
          result.state = isRelearning ? State.Relearning : State.Learning;
          result.remainingSteps = nextRemaining;
          result.scheduledSeconds = delay ?? Math.floor(Math.fround(model.interval * 86400));
          result.scheduledDays = isRelearning
            ? delay === undefined ? fuzz(Math.max(1, Math.round(model.interval)))
              : grade === Rating.Again ? Math.max(1, Math.round(model.interval)) : card.scheduledDays
            : card.scheduledDays;
        } else if (grade === Rating.Easy) {
          const good = fuzz(fsrs.good.interval);
          result.scheduledDays = fuzz(Math.max(1, Math.round(model.interval)), good + 1);
        } else {
          result.scheduledDays = fuzz(Math.max(1, Math.round(model.interval)));
        }
      }
      results[grade] = result;
    }
    return results;
  };

  const review = ({ card, grade, now }: { card: MemoryCard; grade: Grade; now: Date }): ReviewResult => {
    if (![1, 2, 3, 4].includes(grade) || !Number.isFinite(now.getTime())) throw new Error('Invalid review');
    const next = schedulingStates(card, now)[grade];
    const seedId = seedIdFor(card);
    const seed = enableFuzz ? BigInt.asUintN(64, BigInt(seedId) + BigInt(card.reps)) : null;
    let interval: ReviewInterval;
    let dueAt: Date;
    let dueDay: string | undefined;
    if (next.state === State.Review) {
      interval = { kind: 'days', value: next.scheduledDays };
      dueAt = reviewDueDate(now, next.scheduledDays);
      dueDay = studyDayKey(dueAt);
    } else {
      const untilRollover = Math.floor(ankiNextDayAt(now) / 1000) - Math.floor(now.getTime() / 1000);
      if (next.scheduledSeconds >= untilRollover) {
        const days = Math.floor((next.scheduledSeconds - untilRollover) / 86400) + 1;
        interval = { kind: 'days', value: days };
        dueAt = reviewDueDate(now, days);
        dueDay = studyDayKey(dueAt);
      } else {
        interval = { kind: 'seconds', value: next.scheduledSeconds };
        dueAt = new Date((Math.floor(now.getTime() / 1000) + learningIntervalWithFuzz(next.scheduledSeconds, seed)) * 1000);
      }
    }
    const steps = next.state === State.Relearning ? relearn : learn;
    return {
      card: {
        ...card, dueAt, lastReviewAt: new Date(now), ...persistMemoryState(next),
        reps: card.reps + 1, lapses: next.lapses, scheduledDays: next.scheduledDays,
        state: next.state, scheduleStatus: next.state === State.Review ? 'review' : 'learning',
        learningStep: next.state === State.Review ? 0 : Math.max(0, steps.remainingForFailed() - next.remainingSteps),
        anki: {
          version: 1, seedId, remainingSteps: next.remainingSteps, scheduledSeconds: next.scheduledSeconds,
          easeFactor: Math.round(Math.fround(next.easeFactor * 1000)) / 1000,
          ...(dueDay ? { dueDay } : {}), ...(next.leeched || card.anki?.leeched ? { leeched: true } : {}),
        },
      },
      revlog: {
        cardId: card.cardId, dueAt: new Date(card.dueAt), lastReviewAt: card.lastReviewAt ? new Date(card.lastReviewAt) : null,
        reviewTime: new Date(now), stability: card.stability, difficulty: card.difficulty,
        rating: grade, state: card.state, scheduleStatus: card.scheduleStatus,
        scheduledDays: card.scheduledDays, learningStep: card.learningStep,
      },
      interval,
    };
  };
  return { newCard, review, schedulingStates };
}
