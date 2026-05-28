import { beforeEach, describe, expect, it, vi } from 'vitest';

// DB 모킹 — query 호출만 mock
const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({
  query: (sql: string, params: unknown[]): unknown => mockQuery(sql, params),
}));

import type { DailyContext, ThresholdAux } from '../../pattern-match.js';
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

  it('sleep_records.duration_minutes 컬럼을 사용 (wake_at/sleep_at 같은 미존재 컬럼 금지)', async () => {
    // 운영 hotfix 회귀 방어 — Phase 3 머지 시점에 wake_at - sleep_at 추출 SQL이
    // 실제 DB 스키마(`bedtime`/`wake_time`/`duration_minutes`)와 어긋나서 매칭 cron이
    // 트리거 평가 단계에서 throw → matchAllSeedsForDay 전체 실패하던 사고 재발 방지.
    mockQuery.mockResolvedValueOnce({ rows: [{ minutes: '420' }] });
    const aux: ThresholdAux = {
      kind: 'threshold',
      source: 'sleep_minutes',
      op: 'lte',
      value: 420,
    };
    await evaluateThreshold(aux, baseCtx('2026-06-01'));
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0]?.[0] as string;
    expect(sql).toMatch(/duration_minutes/);
    expect(sql).toMatch(/FROM\s+sleep_records/i);
    expect(sql).not.toMatch(/\bwake_at\b/);
    expect(sql).not.toMatch(/\bsleep_at\b/);
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
