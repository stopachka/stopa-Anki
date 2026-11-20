// Adapted from Anki 26.09.4 rslib/src/scheduler/timing.rs.
// Copyright: Ankitects Pty Ltd and contributors. GNU AGPL v3 or later.
// Reference commit: c06370ff4d87cb48d825f90cc83e02b9a4e84ecd.

export const DAY_MS = 86_400_000;
export const DAY_ROLLOVER_HOUR = 4;

function studyDate(now: Date, rolloverHour: number): Date {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), rolloverHour);
  if (now < date) date.setDate(date.getDate() - 1);
  return date;
}

/** A study day follows the local calendar, starting at 4am by default. */
export function studyDayBounds(now: Date, rolloverHour = DAY_ROLLOVER_HOUR): { start: number; end: number } {
  const start = studyDate(now, rolloverHour);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

export function studyDayKey(now: Date, rolloverHour = DAY_ROLLOVER_HOUR): string {
  const date = studyDate(now, rolloverHour);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function calendarOrdinal(now: Date, rolloverHour: number): number {
  const date = studyDate(now, rolloverHour);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

/** Count calendar-day boundaries, rather than elapsed 24-hour durations. */
export function elapsedStudyDays(previous: Date, now: Date, rolloverHour = DAY_ROLLOVER_HOUR): number {
  return Math.max(0, calendarOrdinal(now, rolloverHour) - calendarOrdinal(previous, rolloverHour));
}

/** Anki computes next_day_at using the current UTC offset, even near DST. */
export function ankiNextDayAt(now: Date, rolloverHour = DAY_ROLLOVER_HOUR): number {
  const rollover = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), rolloverHour) + now.getTimezoneOffset() * 60_000;
  return rollover <= now.getTime() ? rollover + DAY_MS : rollover;
}

/** FSRS elapsed days uses the current next-day cutoff, as Anki does. */
export function fsrsElapsedDays(previous: Date, now: Date, rolloverHour = DAY_ROLLOVER_HOUR): number {
  // Anki stores last_review_time as TimestampSecs, even though answer logs
  // retain milliseconds. Truncate here so legacy dates remain unchanged.
  const previousSeconds = Math.floor(previous.getTime() / 1000);
  return Math.max(0, Math.floor((ankiNextDayAt(now, rolloverHour) / 1000 - previousSeconds) / 86_400));
}

/** Preserve a day-based review deadline across local daylight-saving changes. */
export function reviewDueDate(now: Date, days: number, rolloverHour = DAY_ROLLOVER_HOUR): Date {
  const date = studyDate(now, rolloverHour);
  date.setDate(date.getDate() + Math.max(0, Math.floor(days)));
  return date;
}
