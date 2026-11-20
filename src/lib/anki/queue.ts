// Adapted from Anki 26.09.4 rslib/src/scheduler/queue/{mod,learning}.rs
// and queue/builder/{mod,intersperser}.rs.
// Copyright: Ankitects Pty Ltd and contributors. GNU AGPL v3 or later.
// Reference commit: c06370ff4d87cb48d825f90cc83e02b9a4e84ecd.
import { ankiNextDayAt, studyDayKey } from './time.ts';

export const LEARN_AHEAD_MS = 20 * 60_000;
export type QueueCard = { state: number; dueAt: Date; reps?: number; anki?: { dueDay?: string } };
type Word = { id: string };
type Memories = Record<string, QueueCard>;
type DueOverride = { due: number; storedDue: number };

function learning(card: QueueCard): boolean { return card.state === 1 || card.state === 3; }

export function isCardDue(card: QueueCard, now: Date): boolean {
  if (card.state === 0) return false;
  // Existing saved cards retain their exact deadline until their first new-core review.
  return card.anki?.dueDay ? card.anki.dueDay <= studyDayKey(now) : card.dueAt.getTime() <= now.getTime();
}

export function learningAvailable(card: QueueCard, now: Date): boolean {
  if (!learning(card)) return false;
  if (card.anki?.dueDay) return isCardDue(card, now);
  return card.dueAt.getTime() < ankiNextDayAt(now) && card.dueAt.getTime() <= now.getTime() + LEARN_AHEAD_MS;
}

/** Anki's Intersperser; used for due interday learning mixed with due reviews. */
export function intersperse<T>(one: T[], two: T[]): T[] {
  const result: T[] = [];
  let i = 0, j = 0;
  const ratio = Math.fround(Math.fround(one.length + 1) / Math.fround(two.length + 1));
  while (i < one.length || j < two.length) {
    if (i === one.length || (j < two.length && Math.fround(Math.fround(j + 1) * ratio) < Math.fround(i + 1))) result.push(two[j++]);
    else result.push(one[i++]);
  }
  return result;
}

function effectiveDue(id: string, card: QueueCard, overrides: Map<string, DueOverride>): number {
  const override = overrides.get(id);
  return override?.storedDue === card.dueAt.getTime() ? override.due : card.dueAt.getTime();
}

function intraday<T extends Word>(words: T[], memories: Memories, now: Date, overrides: Map<string, DueOverride>): T[] {
  const end = ankiNextDayAt(now);
  return words.filter(word => {
    const card = memories[word.id];
    return card && learning(card) && !card.anki?.dueDay && card.dueAt.getTime() < end;
  }).sort((a, b) => {
    const ac = memories[a.id], bc = memories[b.id];
    return Number(ac.reps === 0) - Number(bc.reps === 0) || effectiveDue(a.id, ac, overrides) - effectiveDue(b.id, bc, overrides);
  });
}

function mainQueue<T extends Word>(words: T[], memories: Memories, now: Date, remainingNew: number): T[] {
  const review: T[] = [], interday: T[] = [], unseen: T[] = [];
  for (const word of words) {
    const card = memories[word.id];
    if (!card || card.state === 0) unseen.push(word);
    else if (isCardDue(card, now)) {
      if (card.state === 2) review.push(word);
      else if (learning(card) && card.anki?.dueDay) interday.push(word);
    }
  }
  const byDue = (a: T, b: T) => memories[a.id].dueAt.getTime() - memories[b.id].dueAt.getTime();
  review.sort(byDue);
  interday.sort(byDue);
  // This app uses Anki's "new cards after reviews" option and textbook order.
  return [...intersperse(review, interday), ...unseen.slice(0, Math.max(0, Math.floor(remainingNew)))];
}

export function selectNextWord<T extends Word>(words: T[], memories: Memories, now: Date, remainingNew = Infinity): T | undefined {
  const overrides = new Map<string, DueOverride>();
  const learn = intraday(words, memories, now, overrides);
  return learn.find(word => memories[word.id].dueAt.getTime() <= now.getTime())
    ?? mainQueue(words, memories, now, remainingNew)[0]
    ?? learn.find(word => memories[word.id].dueAt.getTime() <= now.getTime() + LEARN_AHEAD_MS);
}

/** Keeps Anki's in-session ordering without modifying a card's saved due date. */
export class StudyQueue {
  private overrides = new Map<string, DueOverride>();
  private main: string[] | null = null;
  private day = '';

  reset(): void { this.overrides.clear(); this.main = null; this.day = ''; }

  next<T extends Word>(words: T[], memories: Memories, now: Date, remainingNew = Infinity): T | undefined {
    this.prepare(words, memories, now, remainingNew);
    const learn = intraday(words, memories, now, this.overrides);
    const effective = (word: T) => effectiveDue(word.id, memories[word.id], this.overrides);
    const due = learn.find(word => effective(word) <= now.getTime());
    if (due) return due;
    const mainId = this.main?.[0];
    if (mainId) return words.find(word => word.id === mainId);
    return learn.find(word => effective(word) <= now.getTime() + LEARN_AHEAD_MS);
  }

  answer<T extends Word>(wordId: string, memories: Memories, words: T[], now: Date, remainingNew = Infinity): void {
    this.overrides.delete(wordId);
    if (this.main) this.main = this.main.filter(id => id !== wordId);
    this.prepare(words, memories, now, remainingNew);
    const card = memories[wordId];
    if (!card || !learning(card) || card.anki?.dueDay || card.dueAt.getTime() >= ankiNextDayAt(now) || this.main?.length) return;
    const cutoff = now.getTime() + LEARN_AHEAD_MS;
    if (card.dueAt.getTime() > cutoff) return;
    const next = intraday(words.filter(word => word.id !== wordId), memories, now, this.overrides)[0];
    if (next) {
      const nextDue = effectiveDue(next.id, memories[next.id], this.overrides);
      if (nextDue >= card.dueAt.getTime() && nextDue + 1000 < cutoff) this.overrides.set(wordId, { due: nextDue + 1000, storedDue: card.dueAt.getTime() });
    }
  }

  private prepare<T extends Word>(words: T[], memories: Memories, now: Date, remainingNew: number): void {
    const day = studyDayKey(now);
    if (day !== this.day) { this.reset(); this.day = day; }
    const available = mainQueue(words, memories, now, remainingNew).map(word => word.id);
    if (!this.main) this.main = available;
    else {
      const allowed = new Set(available);
      this.main = this.main.filter(id => allowed.has(id));
      // Newly due legacy timestamp cards or remotely changed cards can join a live session.
      const existing = new Set(this.main);
      const newcomers = available.filter(id => !existing.has(id));
      if (newcomers.length) this.main = [...this.main, ...newcomers];
    }
    for (const [id, override] of this.overrides) {
      const card = memories[id];
      if (!card || !learning(card) || card.anki?.dueDay || card.dueAt.getTime() !== override.storedDue) this.overrides.delete(id);
    }
  }
}
