import { beforeEach, describe, expect, it, vi } from 'vitest';

// insights.ts 11개 detect 함수 모두 mock
vi.mock('../../insights.js', () => ({
  detectStreak: vi.fn(),
  detectSleepTrend: vi.fn(),
  detectSlotGap: vi.fn(),
  detectWeekComparison: vi.fn(),
  detectOverdue: vi.fn(),
  detectCategorySkew: vi.fn(),
  detectDrift: vi.fn(),
  detectRecovery: vi.fn(),
  detectLapseAlert: vi.fn(),
  detectWeeklyRegression: vi.fn(),
  detectSpottyPattern: vi.fn(),
}));

import * as insights from '../../insights.js';
import type { BehaviorBaselineAux, DailyContext } from '../../saju-match.js';
import { evaluateBehaviorBaseline } from '../behavior-baseline.js';

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
