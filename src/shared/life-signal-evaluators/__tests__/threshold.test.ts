import { beforeEach, describe, expect, it, vi } from 'vitest';

// DB 모킹 — query 호출만 mock
const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({
  query: (sql: string, params: unknown[]): unknown => mockQuery(sql, params),
}));

import type { DailyContext, ThresholdAux } from '../../saju-match.js';
import { evaluateThreshold } from '../threshold.js';

const baseCtx = (date: string): DailyContext => ({ date, userId: 1 }) as unknown as DailyContext;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('evaluateThreshold - sleep_minutes', () => {
  it('수면 ≤ 420분(7시간) 시드가 360분 수면일에 true', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ minutes: '360' }] });
    const aux: ThresholdAux = {
      kind: 'threshold',
      source: 'sleep_minutes',
      op: 'lte',
      value: 420,
    };
    expect(await evaluateThreshold(aux, baseCtx('2026-06-01'))).toBe(true);
  });

  it('수면 ≤ 420분 시드가 480분 수면일에 false', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ minutes: '480' }] });
    const aux: ThresholdAux = {
      kind: 'threshold',
      source: 'sleep_minutes',
      op: 'lte',
      value: 420,
    };
    expect(await evaluateThreshold(aux, baseCtx('2026-06-01'))).toBe(false);
  });

  it('수면 기록 없으면 false', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const aux: ThresholdAux = {
      kind: 'threshold',
      source: 'sleep_minutes',
      op: 'lte',
      value: 420,
    };
    expect(await evaluateThreshold(aux, baseCtx('2026-06-01'))).toBe(false);
  });
});

describe('evaluateThreshold - routine_streak_max', () => {
  it('streak ≥ 7 시드가 최대 streak 10일일에 true', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ max_streak: '10' }] });
    const aux: ThresholdAux = {
      kind: 'threshold',
      source: 'routine_streak_max',
      op: 'gte',
      value: 7,
    };
    expect(await evaluateThreshold(aux, baseCtx('2026-06-01'))).toBe(true);
  });

  it('streak ≥ 7 시드가 최대 streak 3일일에 false', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ max_streak: '3' }] });
    const aux: ThresholdAux = {
      kind: 'threshold',
      source: 'routine_streak_max',
      op: 'gte',
      value: 7,
    };
    expect(await evaluateThreshold(aux, baseCtx('2026-06-01'))).toBe(false);
  });

  it('streak 데이터 0일에 false (gte 3)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ max_streak: '0' }] });
    const aux: ThresholdAux = {
      kind: 'threshold',
      source: 'routine_streak_max',
      op: 'gte',
      value: 3,
    };
    expect(await evaluateThreshold(aux, baseCtx('2026-06-01'))).toBe(false);
  });
});
