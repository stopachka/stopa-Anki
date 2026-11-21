import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { id } from '@instantdb/react';
import { db } from './db';
import { deserializeCard, serializeCard, serializeReviewLog, type ReviewRecord } from './card-codec';
import { mergeProgress, mergeReviewHistory, pendingCommittedCards, pendingCommittedReviews } from './progress-state';
import { dayBounds, introducedWordIds } from './daily-limit';
import type { Memories, MemoryCard, ReviewLog } from './scheduler';
import type { Word } from '../types';

export function useProgress({ userId, now = new Date() }: { userId: string; now?: Date }) {
  const { start } = dayBounds(now);
  const query = db.useQuery({
    hanziProgress: { $: { where: { ownerId: userId } } },
    // RWKV reconstructs its recurrent state from the complete event history.
    hanziReviews: { $: { where: { ownerId: userId } } },
  });
  const connectionStatus = db.useConnectionStatus();
  const [saving, setSaving] = useState(false);
  const [syncPending, setSyncPending] = useState(false);
  const [committed, setCommitted] = useState<Memories>({});
  const [committedReviews, setCommittedReviews] = useState<ReviewRecord[]>([]);
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
  const reviews = useMemo(() => mergeReviewHistory(query.data?.hanziReviews ?? [], committedReviews, userId), [query.data, committedReviews, userId]);
  const introductions = useMemo(() => introducedWordIds(reviews, new Date(start)), [reviews, start]);
  useEffect(() => {
    setCommitted(previous => pendingCommittedCards(loaded.memories, previous));
  }, [loaded.memories, committed]);
  useEffect(() => {
    setCommittedReviews(previous => pendingCommittedReviews(query.data?.hanziReviews ?? [], previous, userId));
  }, [query.data, userId, committedReviews]);

  const saveReview = useCallback(async (word: Word, card: MemoryCard, revlog: ReviewLog): Promise<ReviewRecord> => {
    if (inFlight.current) throw new Error('A review is still being saved.');
    if (card.cardId !== word.id || revlog.cardId !== word.id) throw new Error('This review doesn’t match the current word.');
    const review: ReviewRecord = {
      id: id(), ownerId: userId, wordId: word.id, book: word.book, rating: revlog.rating,
      reviewedAt: revlog.reviewTime.getTime(), log: serializeReviewLog(revlog),
    };
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
        db.tx.hanziReviews[review.id].update({
          ownerId: review.ownerId, wordId: review.wordId, book: review.book,
          rating: review.rating, reviewedAt: review.reviewedAt, log: review.log,
        }),
      ]);
      // Instant also resolves while offline after durably enqueueing a transaction.
      // Connection alone doesn't prove a queued write has reached the server.
      setCommitted(previous => ({ ...previous, [word.id]: card }));
      setCommittedReviews(previous => [...previous, review]);
      setSyncPending(result.status === 'enqueued');
      return review;
    } catch {
      throw new Error('Couldn’t save this review. Please try again.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [userId]);

  return {
    memories,
    reviews,
    introductions,
    isLoading: query.isLoading,
    error: query.error ? 'Couldn’t load your saved progress. Please try again.' : loaded.error,
    saving,
    syncPending,
    connectionStatus,
    saveReview,
  };
}
