import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Word } from '../../types';
import type { ReviewRecord } from '../card-codec';
import { State, type Memories } from '../scheduler';
import { RwkvClient } from './client';

type RecallScore = { id: string; recall: number };

// Keep the displayed card stable while scores refresh in the background. A
// changed event history immediately invalidates the old selection snapshot.
export function useRwkv({ userId, words, reviews, memories, enabled }: {
  userId: string;
  words: Word[];
  reviews: ReviewRecord[];
  memories: Memories;
  enabled: boolean;
}) {
  const client = useRef<RwkvClient | null>(null);
  const request = useRef(0);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{ key: string; scores: RecallScore[] } | null>(null);
  const candidates = useMemo(() => {
    return words.filter(word => memories[word.id] && memories[word.id].state !== State.New);
  }, [words, memories]);
  const historyKey = useMemo(() => `${userId}:${JSON.stringify(reviews)}:${JSON.stringify(candidates.map(word => [word.id, memories[word.id].reps, memories[word.id].lastReviewAt?.getTime()]))}`, [userId, reviews, candidates, memories]);

  useEffect(() => {
    const instance = new RwkvClient();
    client.current = instance;
    return () => {
      request.current++;
      client.current?.dispose();
      client.current = null;
    };
  }, [userId]);

  useEffect(() => {
    if (!enabled || !client.current) return;
    const currentRequest = ++request.current;
    const instance = client.current;
    let cancelled = false;
    setError(null);
    void (async () => {
      try {
        await instance.sync(words, reviews);
        if (cancelled || currentRequest !== request.current) return;
        const scores = await instance.rank(candidates, Date.now());
        if (cancelled || currentRequest !== request.current) return;
        setSnapshot({ key: historyKey, scores });
      } catch (cause) {
        if (cancelled || currentRequest !== request.current) return;
        console.error('Unable to prepare the review model', cause);
        setError('Couldn’t prepare your reviews. Your saved progress is safe.');
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, userId, words, reviews, candidates, historyKey, refresh]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') setRefresh(value => value + 1);
    }, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') setRefresh(value => value + 1); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  const retry = useCallback(() => {
    // A failed WASM/model load can leave a worker unusable; retry starts clean.
    request.current++;
    client.current?.dispose();
    client.current = new RwkvClient();
    setError(null);
    setSnapshot(null);
    setRefresh(value => value + 1);
  }, []);
  const isReady = enabled && !error && snapshot !== null && snapshot.key === historyKey;
  return { scores: snapshot?.scores ?? [], isReady, isLoading: enabled && !isReady && !error, error, retry };
}
