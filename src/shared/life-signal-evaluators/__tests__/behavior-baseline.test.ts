import { beforeEach, describe, expect, it, vi } from 'vitest';

// insights/ 11개 detect 함수 모두 mock (정의 파일별)
vi.mock('../../insights/routine-streak.js', () => ({
  detectStreak: vi.fn(),
  detectRecovery: vi.fn(),
  detectLapseAlert: vi.fn(),
}));
vi.mock('../../insights/routine-comparison.js', () => ({
  detectSlotGap: vi.fn(),
  detectWeekComparison: vi.fn(),
}));
vi.mock('../../insights/routine-decline.js', () => ({
  detectWeeklyRegression: vi.fn(),
  detectSpottyPattern: vi.fn(),
}));
vi.mock('../../insights/sleep.js', () => ({
  detectSleepTrend: vi.fn(),
  detectDrift: vi.fn(),
}));
vi.mock('../../insights/schedule.js', () => ({
  detectOverdue: vi.fn(),
  detectCategorySkew: vi.fn(),
}));

import * as routineStreak from '../../insights/routine-streak.js';
import * as routineComparison from '../../insights/routine-comparison.js';
import * as routineDecline from '../../insights/routine-decline.js';
import * as sleep from '../../insights/sleep.js';
import * as schedule from '../../insights/schedule.js';
import type { BehaviorBaselineAux } from '../../pattern/match-aux-types.js';
import type { DailyContext } from '../../pattern/match-types.js';
import { evaluateBehaviorBaseline } from '../behavior-baseline.js';

const insights = {
  ...routineStreak,
  ...routineComparison,
  ...routineDecline,
  ...sleep,
  ...schedule,
};

const baseCtx = (date: string): DailyContext => ({ date, userId: 1 }) as unknown as DailyContext;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('evaluateBehaviorBaseline', () => {
  it('detector가 Insight 반환 시 true (signal 발현)', async () => {
    vi.mocked(insights.detectStreak).mockResolvedValueOnce({
      type: 'streak',
      priority: 6,
      timing: 'morning',
      domain: 'routine',
      message: 'test',
    });
    const aux: BehaviorBaselineAux = { kind: 'behavior_baseline', signal_name: 'streak' };
    expect(await evaluateBehaviorBaseline(aux, baseCtx('2026-06-01'))).toBe(true);
    expect(insights.detectStreak).toHaveBeenCalledWith('2026-06-01', 1);
  });

  it('detector가 null 반환 시 false (signal 미발현)', async () => {
    vi.mocked(insights.detectSleepTrend).mockResolvedValueOnce(null);
    const aux: BehaviorBaselineAux = { kind: 'behavior_baseline', signal_name: 'sleepTrend' };
    expect(await evaluateBehaviorBaseline(aux, baseCtx('2026-06-01'))).toBe(false);
  });

  it('11개 signal_name 모두 정확한 detector에 dispatch', async () => {
    const cases: Array<[BehaviorBaselineAux['signal_name'], keyof typeof insights]> = [
      ['streak', 'detectStreak'],
      ['sleepTrend', 'detectSleepTrend'],
      ['slotGap', 'detectSlotGap'],
      ['weekComparison', 'detectWeekComparison'],
      ['overdueAlert', 'detectOverdue'],
      ['categorySkew', 'detectCategorySkew'],
      ['drift', 'detectDrift'],
      ['recovery', 'detectRecovery'],
      ['lapseAlert', 'detectLapseAlert'],
      ['weeklyRegression', 'detectWeeklyRegression'],
      ['spottyPattern', 'detectSpottyPattern'],
    ];
    for (const [signal, detectorName] of cases) {
      vi.mocked(
        insights[detectorName] as unknown as ReturnType<typeof vi.fn>,
      ).mockResolvedValueOnce(null);
      const aux: BehaviorBaselineAux = { kind: 'behavior_baseline', signal_name: signal };
      await evaluateBehaviorBaseline(aux, baseCtx('2026-06-01'));
      expect(insights[detectorName]).toHaveBeenCalled();
    }
  });
});
