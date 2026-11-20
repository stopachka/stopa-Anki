import type { Memories, MemoryCard } from './scheduler.ts';

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
