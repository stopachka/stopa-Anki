import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from './db';
import { DEFAULT_DAILY_NEW_LIMIT } from './daily-limit';

type SavedSetting = { dailyNewLimit: number; updatedAt: number };

export function useSettings({ userId }: { userId: string }) {
  const query = db.useQuery({ hanziSettings: { $: { where: { ownerId: userId } } } });
  const [saving, setSaving] = useState(false);
  const [syncPending, setSyncPending] = useState(false);
  const [committed, setCommitted] = useState<SavedSetting | null>(null);
  const inFlight = useRef(false);
  const remote = query.data?.hanziSettings.find(row => row.ownerId === userId);
  const latest = committed && (!remote || committed.updatedAt > remote.updatedAt) ? committed : remote;
  const valid = !latest || (Number.isInteger(latest.dailyNewLimit) && latest.dailyNewLimit >= 0 && latest.dailyNewLimit <= 999);

  useEffect(() => {
    if (committed && remote && remote.updatedAt >= committed.updatedAt) setCommitted(null);
  }, [committed, remote]);

  const saveDailyNewLimit = useCallback(async (value: number): Promise<void> => {
    if (!Number.isInteger(value) || value < 0 || value > 999) throw new Error('Choose a whole number from 0 to 999.');
    if (inFlight.current) throw new Error('A setting is still being saved.');
    inFlight.current = true;
    setSaving(true);
    const next = { dailyNewLimit: value, updatedAt: Date.now() };
    try {
      // The lookup supplies ownerId when creating the row. Repeating that unique
      // attribute in update is rejected by Instant for a first-time lookup.
      const result = await db.transact(db.tx.hanziSettings.lookup('ownerId', userId).update(next));
      setCommitted(next);
      setSyncPending(result.status === 'enqueued');
    } catch {
      throw new Error('Couldn’t save this setting. Try again.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [userId]);

  return {
    dailyNewLimit: valid ? latest?.dailyNewLimit ?? DEFAULT_DAILY_NEW_LIMIT : DEFAULT_DAILY_NEW_LIMIT,
    isLoading: query.isLoading,
    error: query.error ? 'Couldn’t load your settings. Try again.' : valid ? null : 'Your daily limit couldn’t be read. Reload before continuing.',
    saving,
    syncPending,
    saveDailyNewLimit,
  };
}
