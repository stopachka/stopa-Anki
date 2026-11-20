import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { id } from '@instantdb/react';
import { State } from 'ts-fsrs';
import { db } from './db';
import { deserializeCard, serializeCard, serializeReviewLog } from './card-codec';
import { mergeProgress, pendingCommittedCards } from './progress-state';
import { dayBounds, introducedWordIds } from './daily-limit';
import type { Memories, MemoryCard, ReviewLog } from './scheduler';
import type { Word } from '../types';

type Introduction = { wordId: string; reviewedAt: number; log: { state: number } };

export function useProgress({ userId, now = new Date() }: { userId: string; now?: Date }) {
  const { start, end } = dayBounds(now);
  const query = db.useQuery({
    hanziProgress: { $: { where: { ownerId: userId } } },
    hanziReviews: { $: { where: { ownerId: userId, reviewedAt: { $gte: start, $lt: end } } } },
  });
  const connectionStatus = db.useConnectionStatus();
  const [saving, setSaving] = useState(false);
  const [syncPending, setSyncPending] = useState(false);
  const [committed, setCommitted] = useState<Memories>({});
  const [committedIntroductions, setCommittedIntroductions] = useState<Introduction[]>([]);
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
  const introductions = useMemo(() => introducedWordIds([
    ...(query.data?.hanziReviews.filter(row => row.ownerId === userId) ?? []),
    ...committedIntroductions,
  ], new Date(start)), [query.data, userId, committedIntroductions, start]);
  useEffect(() => {
    setCommitted(previous => pendingCommittedCards(loaded.memories, previous));
  }, [loaded.memories, committed]);
  useEffect(() => {
    setCommittedIntroductions(previous => {
      const pending = previous.filter(row => row.reviewedAt >= start && row.reviewedAt < end &&
        !query.data?.hanziReviews.some(remote => remote.ownerId === userId && remote.wordId === row.wordId && remote.reviewedAt === row.reviewedAt && remote.log.state === State.New));
      return pending.length === previous.length ? previous : pending;
    });
  }, [query.data, userId, start, end]);

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
      if (revlog.state === State.New) {
        setCommittedIntroductions(previous => [...previous, { wordId: word.id, reviewedAt: revlog.reviewTime.getTime(), log: { state: State.New } }]);
      }
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
    introductions,
    isLoading: query.isLoading,
    error: query.error ? 'Couldn’t load your saved progress. Please try again.' : loaded.error,
    saving,
    syncPending,
    connectionStatus,
    saveReview,
  };
}
