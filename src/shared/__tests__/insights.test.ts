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

vi.mock('../kst.js', () => ({
  getTodayISO: () => '2026-03-15',
  getYesterdayISO: () => '2026-03-14',
}));

import { connectDB } from '../db.js';
import type { Insight } from '../insights.js';
import {
  detectStreak,
  detectSleepTrend,
  detectSlotGap,
  detectWeekComparison,
  detectOverdue,
  detectCategorySkew,
  detectDrift,
  detectRecovery,
  detectLapseAlert,
  detectWeeklyRegression,
  detectSpottyPattern,
  pickMorningNudges,
  pickNightNudges,
  pickWeeklyInsights,
} from '../insights.js';

/** null이 아님을 보장하고 타입 좁히기 */
const defined = (v: Insight | null): Insight => {
  expect(v).not.toBeNull();
  return v as Insight;
};

beforeEach(async () => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue({ release: vi.fn() });
  await connectDB('postgresql://test@localhost/test');
});

// ─── SQL 패턴 기반 응답 매핑 ─────────────────────────────

type MockRow = Record<string, unknown>;

const setupQueryMock = (overrides: Record<string, MockRow[]> = {}): void => {
  // 패턴 순서 주의: 더 구체적인 패턴을 먼저 두어야 더 일반적인 패턴이 가로채지 않는다.
  const defaultResponses: Record<string, MockRow[]> = {
    // streak: 연속 달성 쿼리
    'grp = 0': [],
    // sleepTrend: 최근 3일 수면
    'sleep_type.*night.*ORDER BY date DESC.*LIMIT 3': [],
    // slotGap: 시간대별 달성률
    'time_slot.*GROUP BY.*time_slot.*HAVING': [],
    // overdue: 밀린 일정
    "status = 'todo'.*date < ": [{ count: '0' }],
    // categorySkew: 카테고리 편향
    'window_schedules.*top_category': [],
    // drift: 수면 드리프트
    this_week_avg_bedtime_minutes: [
      {
        this_week_avg_bedtime_minutes: null,
        prev_weeks_avg_bedtime_minutes: null,
        this_week_avg_wake_minutes: null,
        prev_weeks_avg_wake_minutes: null,
        this_week_mid_wake: 0,
        prev_weeks_mid_wake_per_week: 0,
        this_week_nights: 0,
      },
    ],
    // recovery: 루틴 회복
    'recent_records.*break_events.*next_completion': [],
    // lapseAlert: 연속 누락
    'today_miss.*prev_streaks': [],
    // spottyPattern: 산발성 누락
    'miss_groups.*max_consecutive_miss': [],
    // weeklyRegression: 주간 회귀 (weekComparison 패턴보다 먼저 — WHERE last_week.rate가 있는 경우 먼저 매칭)
    'this_week.*last_week.*WHERE last_week.rate': [],
    // weekComparison: 이번주 vs 지난주 (가장 일반적이므로 마지막)
    'this_week.*last_week': [{ this_rate: null, last_rate: null }],
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

// ─── detectStreak ─────────────────────────────────────────

describe('detectStreak', () => {
  it('연속 3일 달성 시 streak 인사이트 반환', async () => {
    setupQueryMock({
      'grp = 0': [{ name: '스트레칭하기', streak: '3' }],
    });

    const result = defined(await detectStreak('2026-03-15', 1));
    expect(result.type).toBe('streak');
    expect(result.message).toContain('스트레칭하기');
    expect(result.message).toContain('3일');
    expect(result.priority).toBe(6); // 3 * 2
  });

  it('연속 7일 달성 시 높은 우선순위', async () => {
    setupQueryMock({
      'grp = 0': [{ name: '유산균 먹기', streak: '7' }],
    });

    const result = defined(await detectStreak('2026-03-15', 1));
    expect(result.priority).toBe(14); // 7 * 2
  });

  it('2일 연속은 임계값 미달 → null', async () => {
    setupQueryMock({
      'grp = 0': [{ name: '스트레칭하기', streak: '2' }],
    });

    const result = await detectStreak('2026-03-15', 1);
    expect(result).toBeNull();
  });

  it('데이터 없으면 null', async () => {
    setupQueryMock();

    const result = await detectStreak('2026-03-15', 1);
    expect(result).toBeNull();
  });

  it('마일스톤(3,5,7,10,14,21,30)이 아닌 날은 null', async () => {
    setupQueryMock({
      'grp = 0': [{ name: '스트레칭하기', streak: '4' }],
    });

    const result = await detectStreak('2026-03-15', 1);
    expect(result).toBeNull();
  });

  it('마일스톤 5일은 감지', async () => {
    setupQueryMock({
      'grp = 0': [{ name: '스트레칭하기', streak: '5' }],
    });

    const result = defined(await detectStreak('2026-03-15', 1));
    expect(result.message).toContain('5일');
  });
});

// ─── detectSleepTrend ─────────────────────────────────────

describe('detectSleepTrend', () => {
  it('3일 연속 감소 + 최신 <7시간이면 감지', async () => {
    setupQueryMock({
      'sleep_type.*night.*ORDER BY date DESC.*LIMIT 3': [
        { date: '2026-03-15', duration_minutes: 360 },
        { date: '2026-03-14', duration_minutes: 390 },
        { date: '2026-03-13', duration_minutes: 420 },
      ],
    });

    const result = defined(await detectSleepTrend('2026-03-15', 1));
    expect(result.type).toBe('sleepTrend');
    expect(result.timing).toBe('night');
    expect(result.priority).toBe(8);
    expect(result.message).toContain('3일째 줄고');
  });

  it('3일 연속 증가면 긍정 인사이트', async () => {
    setupQueryMock({
      'sleep_type.*night.*ORDER BY date DESC.*LIMIT 3': [
        { date: '2026-03-15', duration_minutes: 480 },
        { date: '2026-03-14', duration_minutes: 420 },
        { date: '2026-03-13', duration_minutes: 360 },
      ],
    });

    const result = defined(await detectSleepTrend('2026-03-15', 1));
    expect(result.priority).toBe(4); // 증가는 낮은 우선순위
    expect(result.message).toContain('늘고');
  });

  it('감소하지만 최신 ≥7시간이면 null (충분한 수면)', async () => {
    setupQueryMock({
      'sleep_type.*night.*ORDER BY date DESC.*LIMIT 3': [
        { date: '2026-03-15', duration_minutes: 420 },
        { date: '2026-03-14', duration_minutes: 450 },
        { date: '2026-03-13', duration_minutes: 480 },
      ],
    });

    const result = await detectSleepTrend('2026-03-15', 1);
    expect(result).toBeNull();
  });

  it('데이터 3건 미만이면 null', async () => {
    setupQueryMock({
      'sleep_type.*night.*ORDER BY date DESC.*LIMIT 3': [
        { date: '2026-03-15', duration_minutes: 360 },
        { date: '2026-03-14', duration_minutes: 390 },
      ],
    });

    const result = await detectSleepTrend('2026-03-15', 1);
    expect(result).toBeNull();
  });

  it('변화 없음(동일)이면 null', async () => {
    setupQueryMock({
      'sleep_type.*night.*ORDER BY date DESC.*LIMIT 3': [
        { date: '2026-03-15', duration_minutes: 420 },
        { date: '2026-03-14', duration_minutes: 420 },
        { date: '2026-03-13', duration_minutes: 420 },
      ],
    });

    const result = await detectSleepTrend('2026-03-15', 1);
    expect(result).toBeNull();
  });
});

// ─── detectSlotGap ────────────────────────────────────────

describe('detectSlotGap', () => {
  it('최고-최저 ≥30%이면 감지', async () => {
    // ORDER BY rate ASC: worst first, best last
    setupQueryMock({
      'time_slot.*GROUP BY.*time_slot.*HAVING': [
        { time_slot: '밤', total: '12', done: '5', rate: 42 },
        { time_slot: '낮', total: '14', done: '13', rate: 93 },
      ],
    });

    const result = defined(await detectSlotGap('2026-03-15', 1));
    expect(result.type).toBe('slotGap');
    expect(result.timing).toBe('night');
    expect(result.message).toContain('낮');
    expect(result.message).toContain('밤');
    expect(result.message).toContain('93%');
    expect(result.message).toContain('42%');
  });

  it('격차 <30%이면 null', async () => {
    setupQueryMock({
      'time_slot.*GROUP BY.*time_slot.*HAVING': [
        { time_slot: '낮', total: '14', done: '12', rate: 86 },
        { time_slot: '밤', total: '12', done: '8', rate: 67 },
      ],
    });

    const result = await detectSlotGap('2026-03-15', 1);
    expect(result).toBeNull();
  });

  it('시간대 1개만 있으면 null (비교 불가)', async () => {
    setupQueryMock({
      'time_slot.*GROUP BY.*time_slot.*HAVING': [
        { time_slot: '낮', total: '14', done: '12', rate: 86 },
      ],
    });

    const result = await detectSlotGap('2026-03-15', 1);
    expect(result).toBeNull();
  });
});

// ─── detectWeekComparison ─────────────────────────────────

describe('detectWeekComparison', () => {
  it('이번 주가 지난 주보다 10% 이상 높으면 긍정 인사이트', async () => {
    setupQueryMock({
      'this_week.*last_week': [{ this_rate: 82, last_rate: 65 }],
    });

    const result = defined(await detectWeekComparison('2026-03-15', 1));
    expect(result.type).toBe('weekComparison');
    expect(result.timing).toBe('morning');
    expect(result.priority).toBe(6); // 차이 ≥10
    expect(result.message).toContain('82%');
    expect(result.message).toContain('65%');
  });

  it('이번 주가 지난 주보다 낮으면 밤 타이밍', async () => {
    setupQueryMock({
      'this_week.*last_week': [{ this_rate: 55, last_rate: 72 }],
    });

    const result = defined(await detectWeekComparison('2026-03-15', 1));
    expect(result.timing).toBe('night');
    expect(result.message).toContain('55%');
    expect(result.message).toContain('72%');
  });

  it('차이 <5%이면 null', async () => {
    setupQueryMock({
      'this_week.*last_week': [{ this_rate: 72, last_rate: 70 }],
    });

    const result = await detectWeekComparison('2026-03-15', 1);
    expect(result).toBeNull();
  });

  it('한 주라도 데이터 없으면 null', async () => {
    setupQueryMock({
      'this_week.*last_week': [{ this_rate: 72, last_rate: null }],
    });

    const result = await detectWeekComparison('2026-03-15', 1);
    expect(result).toBeNull();
  });
});

// ─── detectOverdue ────────────────────────────────────────

describe('detectOverdue', () => {
  it('밀린 일정 3건 이상이면 감지', async () => {
    setupQueryMock({
      "status = 'todo'.*date < ": [{ count: '5' }],
    });

    const result = defined(await detectOverdue('2026-03-15', 1));
    expect(result.type).toBe('overdueAlert');
    expect(result.timing).toBe('morning');
    expect(result.priority).toBe(7);
    expect(result.message).toContain('5건');
  });

  it('밀린 일정 2건이면 null', async () => {
    setupQueryMock({
      "status = 'todo'.*date < ": [{ count: '2' }],
    });

    const result = await detectOverdue('2026-03-15', 1);
    expect(result).toBeNull();
  });

  it('밀린 일정 0건이면 null', async () => {
    setupQueryMock({
      "status = 'todo'.*date < ": [{ count: '0' }],
    });

    const result = await detectOverdue('2026-03-15', 1);
    expect(result).toBeNull();
  });
});

// ─── detectCategorySkew ──────────────────────────────────

describe('detectCategorySkew', () => {
  it('지배 카테고리 ≥50%이면 감지', async () => {
    setupQueryMock({
      'window_schedules.*top_category': [{ category_name: '사업', count: 6, total: 10 }],
    });

    const result = defined(await detectCategorySkew('2026-03-15', 1));
    expect(result.type).toBe('categorySkew');
    expect(result.priority).toBe(5);
    expect(result.timing).toBe('night');
    expect(result.message).toContain('사업');
  });

  it('weekly timing 전달 시 메시지 톤 변경', async () => {
    setupQueryMock({
      'window_schedules.*top_category': [{ category_name: '사업', count: 6, total: 10 }],
    });

    const result = defined(await detectCategorySkew('2026-03-15', 1, 'weekly'));
    expect(result.timing).toBe('weekly');
    expect(result.message).toContain('지난주');
  });

  it('전체 일정 5건 미만이면 null', async () => {
    setupQueryMock({
      'window_schedules.*top_category': [{ category_name: '사업', count: 3, total: 4 }],
    });

    const result = await detectCategorySkew('2026-03-15', 1);
    expect(result).toBeNull();
  });

  it('지배 비율 50% 미만이면 null', async () => {
    setupQueryMock({
      'window_schedules.*top_category': [{ category_name: '사업', count: 4, total: 10 }],
    });

    const result = await detectCategorySkew('2026-03-15', 1);
    expect(result).toBeNull();
  });
});

// ─── detectDrift ─────────────────────────────────────────

describe('detectDrift', () => {
  it('취침 시간 30분+ 늦어지면 감지', async () => {
    setupQueryMock({
      this_week_avg_bedtime_minutes: [
        {
          this_week_avg_bedtime_minutes: 1470, // 24:30
          prev_weeks_avg_bedtime_minutes: 1410, // 23:30
          this_week_avg_wake_minutes: 480,
          prev_weeks_avg_wake_minutes: 480,
          this_week_mid_wake: 0,
          prev_weeks_mid_wake_per_week: 0,
          this_week_nights: 5,
        },
      ],
    });

    const result = defined(await detectDrift('2026-03-15', 1));
    expect(result.type).toBe('drift');
    expect(result.timing).toBe('weekly');
    expect(result.message).toContain('취침');
  });

  it('중간기상 1.5배 이상 증가하면 감지', async () => {
    setupQueryMock({
      this_week_avg_bedtime_minutes: [
        {
          this_week_avg_bedtime_minutes: 1410,
          prev_weeks_avg_bedtime_minutes: 1410,
          this_week_avg_wake_minutes: 480,
          prev_weeks_avg_wake_minutes: 480,
          this_week_mid_wake: 6,
          prev_weeks_mid_wake_per_week: 3,
          this_week_nights: 5,
        },
      ],
    });

    const result = defined(await detectDrift('2026-03-15', 1));
    expect(result.message).toContain('중간기상');
  });

  it('이번주 표본 4박 미만이면 null', async () => {
    setupQueryMock({
      this_week_avg_bedtime_minutes: [
        {
          this_week_avg_bedtime_minutes: 1470,
          prev_weeks_avg_bedtime_minutes: 1410,
          this_week_avg_wake_minutes: 480,
          prev_weeks_avg_wake_minutes: 480,
          this_week_mid_wake: 0,
          prev_weeks_mid_wake_per_week: 0,
          this_week_nights: 3,
        },
      ],
    });

    const result = await detectDrift('2026-03-15', 1);
    expect(result).toBeNull();
  });

  it('드리프트 없으면 null', async () => {
    setupQueryMock({
      this_week_avg_bedtime_minutes: [
        {
          this_week_avg_bedtime_minutes: 1410,
          prev_weeks_avg_bedtime_minutes: 1410,
          this_week_avg_wake_minutes: 480,
          prev_weeks_avg_wake_minutes: 480,
          this_week_mid_wake: 1,
          prev_weeks_mid_wake_per_week: 1,
          this_week_nights: 6,
        },
      ],
    });

    const result = await detectDrift('2026-03-15', 1);
    expect(result).toBeNull();
  });
});

// ─── detectRecovery ──────────────────────────────────────

describe('detectRecovery', () => {
  it('5일+ 연속 후 빠졌다가 다음 날 회복하면 감지', async () => {
    setupQueryMock({
      'recent_records.*break_events.*next_completion': [
        { name: '스트레칭하기', break_date: '2026-03-14', recovery_gap_days: 1 },
      ],
    });

    const result = defined(await detectRecovery('2026-03-15', 1));
    expect(result.type).toBe('recovery');
    expect(result.timing).toBe('morning');
    expect(result.message).toContain('스트레칭하기');
  });

  it('회복 케이스 없으면 null', async () => {
    setupQueryMock();

    const result = await detectRecovery('2026-03-15', 1);
    expect(result).toBeNull();
  });
});

// ─── detectLapseAlert ────────────────────────────────────

describe('detectLapseAlert', () => {
  it('7일 연속 달성 후 오늘 빠지면 감지', async () => {
    setupQueryMock({
      'today_miss.*prev_streaks': [{ name: '유산균 먹기' }],
    });

    const result = defined(await detectLapseAlert('2026-03-15', 1));
    expect(result.type).toBe('lapseAlert');
    expect(result.timing).toBe('night');
    expect(result.priority).toBe(7);
    expect(result.message).toContain('유산균 먹기');
  });

  it('조건 미달이면 null', async () => {
    setupQueryMock();

    const result = await detectLapseAlert('2026-03-15', 1);
    expect(result).toBeNull();
  });
});

// ─── detectWeeklyRegression ──────────────────────────────

describe('detectWeeklyRegression', () => {
  it('지난주 90%+ → 이번주 60% 이하면 감지', async () => {
    setupQueryMock({
      'this_week.*last_week.*WHERE last_week.rate': [
        { name: '스트레칭하기', this_rate: 45, last_rate: 95 },
      ],
    });

    const result = defined(await detectWeeklyRegression('2026-03-15', 1));
    expect(result.type).toBe('weeklyRegression');
    expect(result.timing).toBe('weekly');
    expect(result.message).toContain('스트레칭하기');
    expect(result.message).toContain('45%');
  });

  it('해당 없으면 null', async () => {
    setupQueryMock();

    const result = await detectWeeklyRegression('2026-03-15', 1);
    expect(result).toBeNull();
  });
});

// ─── detectSpottyPattern ─────────────────────────────────

describe('detectSpottyPattern', () => {
  it('7일 중 3~4번 산발 누락 + 연속 누락 아님이면 감지', async () => {
    setupQueryMock({
      'miss_groups.*max_consecutive_miss': [
        { name: '스트레칭하기', miss_count: 3, max_consecutive_miss: 1 },
      ],
    });

    const result = defined(await detectSpottyPattern('2026-03-15', 1));
    expect(result.type).toBe('spottyPattern');
    expect(result.timing).toBe('night');
    expect(result.message).toContain('스트레칭하기');
    expect(result.message).toContain('3번');
  });

  it('연속 누락이면 (spotty 아님) null', async () => {
    setupQueryMock({
      'miss_groups.*max_consecutive_miss': [
        // max_consecutive_miss === miss_count → 연속이라 spotty 패턴 아님
      ],
    });

    const result = await detectSpottyPattern('2026-03-15', 1);
    expect(result).toBeNull();
  });

  it('해당 없으면 null', async () => {
    setupQueryMock();

    const result = await detectSpottyPattern('2026-03-15', 1);
    expect(result).toBeNull();
  });
});

// ─── pickMorningNudges / pickNightNudges / pickWeeklyInsights ──

describe('pickMorningNudges (priority threshold + domain dedupe + max items)', () => {
  it('priority ≥5인 morning 인사이트만 반환', async () => {
    setupQueryMock({
      // streak: morning, priority = streak * 2 = 10 (routine)
      'grp = 0': [{ name: '유산균 먹기', streak: '5' }],
      // overdue: morning, priority 7 (schedule)
      "status = 'todo'.*date < ": [{ count: '4' }],
    });

    const insights = await pickMorningNudges('2026-03-15', 1);
    expect(insights.length).toBeGreaterThan(0);
    // priority desc 정렬: streak(10) > overdue(7)
    expect(insights[0]?.type).toBe('streak');
    expect(insights[0]?.message).toContain('유산균 먹기');
  });

  it('같은 도메인 인사이트는 priority 높은 것만 선택', async () => {
    setupQueryMock({
      // streak: morning, priority 10 (routine)
      'grp = 0': [{ name: '유산균 먹기', streak: '5' }],
      // recovery: morning, priority 6 (routine) — 같은 도메인이라 dedupe 대상
      'recent_records.*break_events.*next_completion': [
        { name: '스트레칭하기', break_date: '2026-03-14', recovery_gap_days: 1 },
      ],
    });

    const insights = await pickMorningNudges('2026-03-15', 1);
    const routineCount = insights.filter((i) => i.domain === 'routine').length;
    expect(routineCount).toBe(1); // dedupe: priority 높은 streak만 남음
    expect(insights[0]?.type).toBe('streak');
  });

  it('최대 3개만 반환 (도메인은 routine/sleep/schedule 3종)', async () => {
    setupQueryMock({
      'grp = 0': [{ name: '유산균 먹기', streak: '5' }], // routine, prio 10
      "status = 'todo'.*date < ": [{ count: '5' }], // schedule, prio 7
    });

    const insights = await pickMorningNudges('2026-03-15', 1);
    expect(insights.length).toBeLessThanOrEqual(3);
  });

  it('priority <5인 인사이트는 제외', async () => {
    setupQueryMock({
      // sleepTrend(증가): priority 4 (임계값 미달)
      'sleep_type.*night.*ORDER BY date DESC.*LIMIT 3': [
        { date: '2026-03-15', duration_minutes: 480 },
        { date: '2026-03-14', duration_minutes: 420 },
        { date: '2026-03-13', duration_minutes: 360 },
      ],
    });

    const insights = await pickMorningNudges('2026-03-15', 1);
    expect(insights.length).toBe(0);
  });

  it('아무 인사이트도 없으면 빈 배열', async () => {
    setupQueryMock();

    const insights = await pickMorningNudges('2026-03-15', 1);
    expect(insights).toEqual([]);
  });
});

describe('pickNightNudges', () => {
  it('night 타이밍 인사이트만 선택', async () => {
    setupQueryMock({
      // sleepTrend: night, priority 8
      'sleep_type.*night.*ORDER BY date DESC.*LIMIT 3': [
        { date: '2026-03-15', duration_minutes: 300 },
        { date: '2026-03-14', duration_minutes: 360 },
        { date: '2026-03-13', duration_minutes: 420 },
      ],
    });

    const insights = await pickNightNudges('2026-03-15', 1);
    expect(insights[0]?.type).toBe('sleepTrend');
    expect(insights[0]?.message).toContain('줄고');
  });
});

describe('pickWeeklyInsights', () => {
  it('weekly 타이밍 인사이트만 선택', async () => {
    setupQueryMock({
      // weeklyRegression: weekly, priority 6
      'this_week.*last_week.*WHERE last_week.rate': [
        { name: '스트레칭하기', this_rate: 50, last_rate: 95 },
      ],
    });

    const insights = await pickWeeklyInsights('2026-03-15', 1);
    expect(insights[0]?.type).toBe('weeklyRegression');
  });

  it('weekly 타이밍에 morning 인사이트는 제외', async () => {
    setupQueryMock({
      // streak는 morning만 → weekly에서는 안 잡힘
      'grp = 0': [{ name: '유산균 먹기', streak: '5' }],
    });

    const insights = await pickWeeklyInsights('2026-03-15', 1);
    expect(insights.find((i) => i.type === 'streak')).toBeUndefined();
  });
});

// ─── DB 오류 처리 ─────────────────────────────────────────

// ─── 분할 수면 정합 (날짜별 집계) ─────────────────────────

describe('분할 수면 정합 (GROUP BY date)', () => {
  it('detectSleepTrend SQL은 날짜별 SUM(duration_minutes) + GROUP BY date', async () => {
    setupQueryMock();
    await detectSleepTrend('2026-03-15', 1);
    const sql = mockQuery.mock.calls.map((c) => c[0] as string).find((s) => /LIMIT 3/.test(s));
    // 행 단위(세그먼트)로 3일 트렌드를 잡으면 분할일이 별도 데이터포인트가 됨
    expect(sql).toMatch(/GROUP BY date/);
    expect(sql).toMatch(/SUM\(duration_minutes\)/);
  });

  it('detectDrift SQL은 날짜별 onset(MIN)·기상(MAX)·합산으로 정합', async () => {
    setupQueryMock();
    await detectDrift('2026-03-15', 1);
    const sql = mockQuery.mock.calls
      .map((c) => c[0] as string)
      .find((s) => /this_week_avg_bedtime_minutes/.test(s));
    expect(sql).toMatch(/this_week_daily/);
    expect(sql).toMatch(/GROUP BY date/);
    // 취침=첫 세그먼트 onset(20:00 래핑 최솟값), 기상=마지막 세그먼트
    expect(sql).toMatch(/MIN\(CASE WHEN bedtime/);
    expect(sql).toMatch(/MAX\(EXTRACT\(EPOCH FROM wake_time/);
  });
});

describe('에러 처리', () => {
  it('DB 오류 시 각 감지 함수는 null 반환', async () => {
    mockQuery.mockRejectedValue(new Error('DB connection lost'));

    expect(await detectStreak('2026-03-15', 1)).toBeNull();
    expect(await detectSleepTrend('2026-03-15', 1)).toBeNull();
    expect(await detectSlotGap('2026-03-15', 1)).toBeNull();
    expect(await detectWeekComparison('2026-03-15', 1)).toBeNull();
    expect(await detectOverdue('2026-03-15', 1)).toBeNull();
    expect(await detectCategorySkew('2026-03-15', 1)).toBeNull();
    expect(await detectDrift('2026-03-15', 1)).toBeNull();
    expect(await detectRecovery('2026-03-15', 1)).toBeNull();
    expect(await detectLapseAlert('2026-03-15', 1)).toBeNull();
    expect(await detectWeeklyRegression('2026-03-15', 1)).toBeNull();
    expect(await detectSpottyPattern('2026-03-15', 1)).toBeNull();
  });

  it('DB 오류 시 pickMorningNudges는 빈 배열 반환', async () => {
    mockQuery.mockRejectedValue(new Error('DB connection lost'));

    const insights = await pickMorningNudges('2026-03-15', 1);
    expect(insights).toEqual([]);
  });
});
