import { addDays } from './date.ts';

export type StreakRecord = {
  count: number;
  lastDate: string | null;
};

export function emptyStreak(): StreakRecord {
  return { count: 0, lastDate: null };
}

/** Completing the same Tokyo date twice does not add another day. */
export function recordCompletion(prev: StreakRecord, date: string): StreakRecord {
  if (prev.lastDate === date) return prev;
  const continued = prev.lastDate === addDays(date, -1);
  return {
    count: continued ? prev.count + 1 : 1,
    lastDate: date,
  };
}

/**
 * The streak still shows on the morning after a finish, so a player can
 * see what they are continuing. It drops to 0 once a day has been missed.
 */
export function visibleStreak(record: StreakRecord, today: string): number {
  if (!record.lastDate || record.count <= 0) return 0;
  if (record.lastDate === today || record.lastDate === addDays(today, -1)) {
    return record.count;
  }
  return 0;
}

export function streakLabel(days: number): string {
  return days === 1 ? 'Streak 1 day' : `Streak ${days} days`;
}
