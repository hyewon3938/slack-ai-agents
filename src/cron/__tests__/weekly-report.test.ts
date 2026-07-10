import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB 모킹 ──

const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn();

vi.mock('pg', () => {
  const MockPool = vi.fn(function (this: Record<string, unknown>) {
    this.query = mockQuery;
    this.connect = mockConnect;
    this.end = mockEnd;
  });
  return { default: { Pool: MockPool, types: { setTypeParser: vi.fn() } } };
});

vi.mock('../../shared/kst.js', () => ({
  getTodayISO: () => '2026-03-15',
  getKSTDayOfWeek: () => 0,
  formatDateShort: (d: string) => {
    const parts = d.split('-');
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const date = new Date(`${d}T12:00:00+09:00`);
    return `${Number(parts[1])}/${Number(parts[2])}(${dayNames[date.getUTCDay()]})`;
  },
  addDays: (d: string, days: number) => {
    const date = new Date(`${d}T12:00:00+09:00`);
    date.setUTCDate(date.getUTCDate() + days);
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  },
}));

import { connectDB } from '../../shared/db.js';
import {
  aggregateWeeklySleep,
  aggregateWeeklyRoutine,
  aggregateWeeklySchedule,
  aggregateSleepRoutineCorrelation,
  aggregateSajuOutcome,
} from '../weekly-report.js';

beforeEach(async () => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue({ release: vi.fn() });
  await connectDB('postgresql://test@localhost/test');
});

// ─── SQL 패턴 기반 응답 매핑 ─────────────────────────────

type MockRow = Record<string, unknown>;

const setupQueryMock = (overrides: Record<string, MockRow[]> = {}): void => {
  const defaultResponses: Record<string, MockRow[]> = {
    // sleep: 주간 수면 집계 (avg_duration AS로 유니크하게 매칭)
    'avg_duration.*record_count': [
      {
        avg_duration: null,
        record_count: 0,
        best_date: null,
        best_duration: null,
        worst_date: null,
        worst_duration: null,
      },
    ],
    // routine rate: 이번주 vs 지난주
    'this_week_total.*last_week_rate': [
      {
        this_week_total: 0,
        this_week_done: 0,
        this_week_rate: null,
        last_week_rate: null,
      },
    ],
    // routine slot breakdown
    'GROUP BY t\\.time_slot': [],
    // routine best/worst
    'GROUP BY t\\.id, t\\.name': [],
    // schedule summary
    'cancelled.*schedules': [
      {
        completed_count: 0,
        incomplete_count: 0,
        cancelled_count: 0,
      },
    ],
    // schedule categories
    'COALESCE.*category': [],
    // schedule overdue
    'overdue_count.*schedules': [{ overdue_count: 0 }],
    // correlation
    good_sleep_rate: [{ good_sleep_rate: null, bad_sleep_rate: null }],
  };

  const responses = { ...defaultResponses, ...overrides };

  mockQuery.mockImplementation((sql: string) => {
    for (const [pattern, rows] of Object.entries(responses)) {
      if (new RegExp(pattern, 's').test(sql)) {
        return Promise.resolve({ rows });
      }
    }
    return Promise.resolve({ rows: [] });
  });
};

// ─── aggregateWeeklySleep ────────────────────────────────

describe('aggregateWeeklySleep', () => {
  it('정상 데이터 집계', async () => {
    setupQueryMock({
      'avg_duration.*record_count': [
        {
          avg_duration: 402,
          record_count: 5,
          best_date: '2026-03-12',
          best_duration: 480,
          worst_date: '2026-03-14',
          worst_duration: 270,
        },
      ],
    });

    const result = await aggregateWeeklySleep('2026-03-09', '2026-03-15');
    expect(result.avgDuration).toBe(402);
    expect(result.recordCount).toBe(5);
    expect(result.bestDay).toEqual({ date: '2026-03-12', duration: 480 });
    expect(result.worstDay).toEqual({ date: '2026-03-14', duration: 270 });
  });

  it('데이터 없으면 기본값', async () => {
    setupQueryMock();

    const result = await aggregateWeeklySleep('2026-03-09', '2026-03-15');
    expect(result.avgDuration).toBe(0);
    expect(result.recordCount).toBe(0);
    expect(result.bestDay).toBeNull();
    expect(result.worstDay).toBeNull();
  });

  it('best = worst (1건만) 일 때도 정상', async () => {
    setupQueryMock({
      'avg_duration.*record_count': [
        {
          avg_duration: 420,
          record_count: 1,
          best_date: '2026-03-12',
          best_duration: 420,
          worst_date: '2026-03-12',
          worst_duration: 420,
        },
      ],
    });

    const result = await aggregateWeeklySleep('2026-03-09', '2026-03-15');
    expect(result.recordCount).toBe(1);
    expect(result.bestDay?.date).toBe('2026-03-12');
    expect(result.worstDay?.date).toBe('2026-03-12');
  });
});

// ─── aggregateWeeklyRoutine ──────────────────────────────

describe('aggregateWeeklyRoutine', () => {
  it('정상 데이터 집계 (이번주 + 지난주)', async () => {
    setupQueryMock({
      'this_week_total.*last_week_rate': [
        {
          this_week_total: 72,
          this_week_done: 52,
          this_week_rate: 72,
          last_week_rate: 65,
        },
      ],
      'GROUP BY t\\.time_slot': [
        { slot: '아침', rate: 85 },
        { slot: '점심', rate: 70 },
        { slot: '밤', rate: 55 },
      ],
      'GROUP BY t\\.id, t\\.name': [
        { name: '스트레칭하기', rate: 100 },
        { name: '독서', rate: 28 },
      ],
    });

    const result = await aggregateWeeklyRoutine('2026-03-09', '2026-03-15');
    expect(result.thisWeekRate).toBe(72);
    expect(result.thisWeekCompleted).toBe(52);
    expect(result.thisWeekTotal).toBe(72);
    expect(result.lastWeekRate).toBe(65);
    expect(result.slotBreakdown).toEqual([
      { slot: '아침', rate: 85 },
      { slot: '점심', rate: 70 },
      { slot: '밤', rate: 55 },
    ]);
    expect(result.bestRoutine).toEqual({ name: '스트레칭하기', rate: 100 });
    expect(result.worstRoutine).toEqual({ name: '독서', rate: 28 });
  });

  it('지난주 데이터 없으면 lastWeekRate = null', async () => {
    setupQueryMock({
      'this_week_total.*last_week_rate': [
        {
          this_week_total: 30,
          this_week_done: 20,
          this_week_rate: 67,
          last_week_rate: null,
        },
      ],
    });

    const result = await aggregateWeeklyRoutine('2026-03-09', '2026-03-15');
    expect(result.thisWeekRate).toBe(67);
    expect(result.lastWeekRate).toBeNull();
  });

  it('데이터 없으면 기본값', async () => {
    setupQueryMock();

    const result = await aggregateWeeklyRoutine('2026-03-09', '2026-03-15');
    expect(result.thisWeekTotal).toBe(0);
    expect(result.thisWeekCompleted).toBe(0);
    expect(result.slotBreakdown).toEqual([]);
    expect(result.bestRoutine).toBeNull();
    expect(result.worstRoutine).toBeNull();
  });
});

// ─── aggregateWeeklySchedule ─────────────────────────────

describe('aggregateWeeklySchedule', () => {
  it('정상 데이터 집계', async () => {
    setupQueryMock({
      'cancelled.*schedules': [
        {
          completed_count: 8,
          incomplete_count: 3,
          cancelled_count: 1,
        },
      ],
      'COALESCE.*category': [
        { category: '개인', count: 5 },
        { category: '사업', count: 4 },
        { category: '약속', count: 3 },
      ],
      'overdue_count.*schedules': [{ overdue_count: 2 }],
    });

    const result = await aggregateWeeklySchedule('2026-03-09', '2026-03-15');
    expect(result.completedCount).toBe(8);
    expect(result.incompleteCount).toBe(3);
    expect(result.cancelledCount).toBe(1);
    expect(result.categories).toEqual([
      { category: '개인', count: 5 },
      { category: '사업', count: 4 },
      { category: '약속', count: 3 },
    ]);
    expect(result.overdueCount).toBe(2);
  });

  it('데이터 없으면 기본값', async () => {
    setupQueryMock();

    const result = await aggregateWeeklySchedule('2026-03-09', '2026-03-15');
    expect(result.completedCount).toBe(0);
    expect(result.incompleteCount).toBe(0);
    expect(result.cancelledCount).toBe(0);
    expect(result.categories).toEqual([]);
    expect(result.overdueCount).toBe(0);
  });
});

// ─── aggregateSleepRoutineCorrelation ────────────────────

describe('aggregateSleepRoutineCorrelation', () => {
  it('정상 데이터 — 수면 vs 루틴 상관관계', async () => {
    setupQueryMock({
      good_sleep_rate: [{ good_sleep_rate: 85, bad_sleep_rate: 52 }],
    });

    const result = await aggregateSleepRoutineCorrelation('2026-03-09', '2026-03-15');
    expect(result.goodSleepRate).toBe(85);
    expect(result.badSleepRate).toBe(52);
  });

  it('데이터 부족 시 null', async () => {
    setupQueryMock();

    const result = await aggregateSleepRoutineCorrelation('2026-03-09', '2026-03-15');
    expect(result.goodSleepRate).toBeNull();
    expect(result.badSleepRate).toBeNull();
  });

  it('한쪽만 데이터 있을 때', async () => {
    setupQueryMock({
      good_sleep_rate: [{ good_sleep_rate: 78, bad_sleep_rate: null }],
    });

    const result = await aggregateSleepRoutineCorrelation('2026-03-09', '2026-03-15');
    expect(result.goodSleepRate).toBe(78);
    expect(result.badSleepRate).toBeNull();
  });
});

// ─── aggregateSajuOutcome ────────────────────────────────

describe('aggregateSajuOutcome', () => {
  it('active 시드 없으면 빈 seeds + 빈 weakCandidates', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (/pattern_catalog/.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const result = await aggregateSajuOutcome(1);
    expect(result.seeds).toEqual([]);
    expect(result.weakCandidates).toEqual([]);
  });

  it('hit/miss 값으로 hitRate 계산', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (/pattern_catalog/.test(sql)) {
        return Promise.resolve({
          rows: [
            {
              name: 'S1',
              sipsin: '편재',
              description: '일운 천간 갑목(편재) → 일정/지출 폭증 가능성',
              hit_count: 7,
              miss_count: 3,
              inconclusive_count: 1,
            },
            {
              name: 'S2',
              sipsin: null,
              description: null,
              hit_count: 0,
              miss_count: 0,
              inconclusive_count: 5,
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await aggregateSajuOutcome(1);
    expect(result.seeds).toHaveLength(2);
    expect(result.seeds[0]).toEqual({
      name: 'S1',
      sipsin: '편재',
      description: '일운 천간 갑목(편재) → 일정/지출 폭증 가능성',
      hit: 7,
      miss: 3,
      inconclusive: 1,
      hitRate: 0.7,
    });
    // total=0이면 hitRate null
    expect(result.seeds[1]?.hitRate).toBeNull();
    // description null 허용
    expect(result.seeds[1]?.description).toBeNull();
  });

  it('약화 후보: total ≥ 10 + hitRate < 0.3 인 시드만 포함', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (/pattern_catalog/.test(sql)) {
        return Promise.resolve({
          rows: [
            // 약화: total=12, hitRate=2/12≈0.17 < 0.3
            {
              name: 'WEAK1',
              sipsin: null,
              description: null,
              hit_count: 2,
              miss_count: 10,
              inconclusive_count: 0,
            },
            // 약화 X (total<10): total=8
            {
              name: 'SMALL',
              sipsin: null,
              description: null,
              hit_count: 0,
              miss_count: 8,
              inconclusive_count: 0,
            },
            // 약화 X (hitRate 충분): total=10, hitRate=0.5
            {
              name: 'OKAY',
              sipsin: null,
              description: null,
              hit_count: 5,
              miss_count: 5,
              inconclusive_count: 0,
            },
            // 약화 경계: total=10, hitRate=0.2 < 0.3
            {
              name: 'WEAK2',
              sipsin: null,
              description: null,
              hit_count: 2,
              miss_count: 8,
              inconclusive_count: 0,
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await aggregateSajuOutcome(1);
    expect(result.weakCandidates.map((s) => s.name)).toEqual(['WEAK1', 'WEAK2']);
  });

  it('DB 오류 시 빈 기본값 반환 (try/catch 폴백)', async () => {
    mockQuery.mockRejectedValue(new Error('DB connection lost'));

    const result = await aggregateSajuOutcome(1);
    expect(result.seeds).toEqual([]);
    expect(result.weakCandidates).toEqual([]);
  });
});

// ─── DB 오류 처리 ────────────────────────────────────────

describe('에러 처리', () => {
  it('DB 오류 시 각 집계 함수는 기본값 반환', async () => {
    mockQuery.mockRejectedValue(new Error('DB connection lost'));

    const sleep = await aggregateWeeklySleep('2026-03-09', '2026-03-15');
    expect(sleep.recordCount).toBe(0);

    const routine = await aggregateWeeklyRoutine('2026-03-09', '2026-03-15');
    expect(routine.thisWeekTotal).toBe(0);

    const schedule = await aggregateWeeklySchedule('2026-03-09', '2026-03-15');
    expect(schedule.completedCount).toBe(0);

    const correlation = await aggregateSleepRoutineCorrelation('2026-03-09', '2026-03-15');
    expect(correlation.goodSleepRate).toBeNull();
  });
});

// ─── 분할 수면 정합 (날짜별 집계) ────────────────────────

describe('분할 수면 정합 (GROUP BY date)', () => {
  it('aggregateWeeklySleep SQL은 날짜별 SUM(duration_minutes) + GROUP BY date', async () => {
    setupQueryMock();
    await aggregateWeeklySleep('2026-03-09', '2026-03-15');
    const sql = mockQuery.mock.calls
      .map((c) => c[0] as string)
      .find((s) => /avg_duration/.test(s) && /record_count/.test(s));
    // 세그먼트 단위면 best/worst가 분할일의 짧은 조각을 최저로 잡고 평균·건수가 왜곡됨
    expect(sql).toMatch(/GROUP BY date/);
    expect(sql).toMatch(/SUM\(duration_minutes\)/);
  });

  it('상관관계 daily_sleep는 날짜별 합산 (분할일이 짧은 수면 2건으로 오분류되지 않게)', async () => {
    setupQueryMock();
    await aggregateSleepRoutineCorrelation('2026-03-09', '2026-03-15');
    const sql = mockQuery.mock.calls
      .map((c) => c[0] as string)
      .find((s) => /good_sleep_rate/.test(s));
    expect(sql).toMatch(/daily_sleep/);
    expect(sql).toMatch(/SUM\(duration_minutes\)/);
    expect(sql).toMatch(/GROUP BY date/);
  });
});
