import { describe, expect, it } from 'vitest';
import { emptyStreak, recordCompletion, streakLabel, visibleStreak } from '../src/streak.ts';

describe('streaks', () => {
  it('counts consecutive Tokyo dates and ignores a second finish on the same day', () => {
    let streak = emptyStreak();
    streak = recordCompletion(streak, '2026-10-29');
    expect(streak).toEqual({ count: 1, lastDate: '2026-10-29' });
    streak = recordCompletion(streak, '2026-10-29');
    expect(streak.count).toBe(1);
    streak = recordCompletion(streak, '2026-10-30');
    expect(streak.count).toBe(2);
    streak = recordCompletion(streak, '2026-11-01');
    expect(streak).toEqual({ count: 1, lastDate: '2026-11-01' });
  });

  it('keeps yesterday visible and clears a missed day', () => {
    const streak = { count: 4, lastDate: '2026-10-30' };
    expect(visibleStreak(streak, '2026-10-30')).toBe(4);
    expect(visibleStreak(streak, '2026-10-31')).toBe(4);
    expect(visibleStreak(streak, '2026-11-01')).toBe(0);
    expect(visibleStreak(emptyStreak(), '2026-10-31')).toBe(0);
    expect(streakLabel(1)).toBe('Streak 1 day');
    expect(streakLabel(4)).toBe('Streak 4 days');
  });
});
