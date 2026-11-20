import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { id } from '@instantdb/react';
import { db } from './db';
import { deserializeCard, serializeCard, serializeReviewLog } from './card-codec';
import { mergeProgress, pendingCommittedCards } from './progress-state';
import type { Memories, MemoryCard, ReviewLog } from './scheduler';
import type { Word } from '../types';

export function useProgress({ userId }: { userId: string }) {
  const query = db.useQuery({ hanziProgress: { $: { where: { ownerId: userId } } } });
  const connectionStatus = db.useConnectionStatus();
  const [saving, setSaving] = useState(false);
  const [syncPending, setSyncPending] = useState(false);
  const [committed, setCommitted] = useState<Memories>({});
  const inFlight = useRef(false);

  const loaded = useMemo(() => {
    const memories: Memories = {};
    try {
      for (const row of query.data?.hanziProgress ?? []) {
        if (row.ownerId !== userId || row.key !== `${userId}:${row.wordId}`) throw new Error('Invalid progress owner');
        const card = deserializeCard(row.card);
        if (card.cardId !== row.wordId) throw new Error('Invalid progress card ID');
        memories[row.wordId] = card;
      }
      return { memories, error: null };
    } catch {
      return { memories: {} as Memories, error: 'Some saved progress couldn’t be read. Reload before continuing.' };
    }
  }, [query.data, userId]);

  const memories = useMemo(() => mergeProgress(loaded.memories, committed), [loaded.memories, committed]);
  useEffect(() => {
    setCommitted(previous => pendingCommittedCards(loaded.memories, previous));
  }, [loaded.memories, committed]);

  const saveReview = useCallback(async (word: Word, card: MemoryCard, revlog: ReviewLog): Promise<void> => {
    if (inFlight.current) throw new Error('A review is still being saved.');
    if (card.cardId !== word.id || revlog.cardId !== word.id) throw new Error('This review doesn’t match the current word.');
    inFlight.current = true;
    setSaving(true);
    try {
      const result = await db.transact([
        db.tx.hanziProgress.lookup('key', `${userId}:${word.id}`).update({
          ownerId: userId,
          wordId: word.id,
          book: word.book,
          card: serializeCard(card),
          updatedAt: Date.now(),
        }),
        db.tx.hanziReviews[id()].update({
          ownerId: userId,
          wordId: word.id,
          book: word.book,
          rating: revlog.rating,
          reviewedAt: revlog.reviewTime.getTime(),
          log: serializeReviewLog(revlog),
        }),
      ]);
      // Instant also resolves while offline after durably enqueueing a transaction.
      // Connection alone doesn't prove a queued write has reached the server.
      setCommitted(previous => ({ ...previous, [word.id]: card }));
      setSyncPending(result.status === 'enqueued');
    } catch {
      throw new Error('Couldn’t save this review. Please try again.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [userId]);

  return {
    memories,
    isLoading: query.isLoading,
    error: query.error ? 'Couldn’t load your saved progress. Please try again.' : loaded.error,
    saving,
    syncPending,
    connectionStatus,
    saveReview,
  };
}
