import type { Memories, MemoryCard } from './scheduler.ts';
import type { ReviewRecord } from './card-codec.ts';

// Event IDs, rather than timestamps or word IDs, distinguish two real answers
// to the same card. A remote copy replaces the acknowledged local copy once.
export function mergeReviewHistory(remote: readonly ReviewRecord[], committed: readonly ReviewRecord[], ownerId: string): ReviewRecord[] {
  const events = new Map<string, ReviewRecord>();
  for (const event of committed) if (event.ownerId === ownerId) events.set(event.id, event);
  for (const event of remote) if (event.ownerId === ownerId) events.set(event.id, event);
  return [...events.values()].sort((left, right) => left.reviewedAt - right.reviewedAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

export function pendingCommittedReviews(remote: readonly ReviewRecord[], committed: ReviewRecord[], ownerId: string): ReviewRecord[] {
  const seen = new Set(remote.filter(event => event.ownerId === ownerId).map(event => event.id));
  const pending = committed.filter(event => event.ownerId === ownerId && !seen.has(event.id));
  return pending.length === committed.length ? committed : pending;
}

function caughtUp(remote: MemoryCard | undefined, committed: MemoryCard): boolean {
  if (!remote) return false;
  const remoteTime = remote.lastReviewAt?.getTime() ?? 0;
  const committedTime = committed.lastReviewAt?.getTime() ?? 0;
  return remoteTime > committedTime || (remoteTime === committedTime && remote.reps >= committed.reps);
}

// Keep acknowledged writes visible until the live query delivers that revision.
// A newer remote review wins, including one made on another device.
export function pendingCommittedCards(remote: Memories, committed: Memories): Memories {
  let pending = committed;
  for (const [wordId, card] of Object.entries(committed)) {
    if (caughtUp(remote[wordId], card)) {
      if (pending === committed) pending = { ...committed };
      delete pending[wordId];
    }
  }
  return pending;
}

export function mergeProgress(remote: Memories, committed: Memories): Memories {
  const pending = pendingCommittedCards(remote, committed);
  return Object.keys(pending).length ? { ...remote, ...pending } : remote;
}
