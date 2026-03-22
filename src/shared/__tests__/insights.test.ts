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
  pickMorningNudge,
  pickNightNudge,
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
  const defaultResponses: Record<string, MockRow[]> = {
    // streak: 연속 달성 쿼리
    'grp = 0': [],
    // sleepTrend: 최근 3일 수면
    'sleep_type.*night.*ORDER BY date DESC.*LIMIT 3': [],
    // slotGap: 시간대별 달성률
    'time_slot.*GROUP BY.*time_slot.*HAVING': [],
    // weekComparison: 이번주 vs 지난주
    'this_week.*last_week': [{ this_rate: null, last_rate: null }],
    // overdue: 밀린 일정
    "status = 'todo'.*date < ": [{ overdue_count: 0 }],
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

    const result = defined(await detectStreak('2026-03-15'));
    expect(result.type).toBe('streak');
    expect(result.message).toContain('스트레칭하기');
    expect(result.message).toContain('3일');
    expect(result.priority).toBe(6); // 3 * 2
  });

  it('연속 7일 달성 시 높은 우선순위', async () => {
    setupQueryMock({
      'grp = 0': [{ name: '유산균 먹기', streak: '7' }],
    });

    const result = defined(await detectStreak('2026-03-15'));
    expect(result.priority).toBe(14); // 7 * 2
  });

  it('2일 연속은 임계값 미달 → null', async () => {
    setupQueryMock({
      'grp = 0': [{ name: '스트레칭하기', streak: '2' }],
    });

    const result = await detectStreak('2026-03-15');
    expect(result).toBeNull();
  });

  it('데이터 없으면 null', async () => {
    setupQueryMock();

    const result = await detectStreak('2026-03-15');
    expect(result).toBeNull();
  });

  it('마일스톤(3,5,7,10,14,21,30)이 아닌 날은 null', async () => {
    setupQueryMock({
      'grp = 0': [{ name: '스트레칭하기', streak: '4' }],
    });

    const result = await detectStreak('2026-03-15');
    expect(result).toBeNull();
  });

  it('마일스톤 5일은 감지', async () => {
    setupQueryMock({
      'grp = 0': [{ name: '스트레칭하기', streak: '5' }],
    });

    const result = defined(await detectStreak('2026-03-15'));
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

    const result = defined(await detectSleepTrend('2026-03-15'));
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

    const result = defined(await detectSleepTrend('2026-03-15'));
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

    const result = await detectSleepTrend('2026-03-15');
    expect(result).toBeNull();
  });

  it('데이터 3건 미만이면 null', async () => {
    setupQueryMock({
      'sleep_type.*night.*ORDER BY date DESC.*LIMIT 3': [
        { date: '2026-03-15', duration_minutes: 360 },
        { date: '2026-03-14', duration_minutes: 390 },
      ],
    });

    const result = await detectSleepTrend('2026-03-15');
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

    const result = await detectSleepTrend('2026-03-15');
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

    const result = defined(await detectSlotGap('2026-03-15'));
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

    const result = await detectSlotGap('2026-03-15');
    expect(result).toBeNull();
  });

  it('시간대 1개만 있으면 null (비교 불가)', async () => {
    setupQueryMock({
      'time_slot.*GROUP BY.*time_slot.*HAVING': [
        { time_slot: '낮', total: '14', done: '12', rate: 86 },
      ],
    });

    const result = await detectSlotGap('2026-03-15');
    expect(result).toBeNull();
  });
});

// ─── detectWeekComparison ─────────────────────────────────

describe('detectWeekComparison', () => {
  it('이번 주가 지난 주보다 10% 이상 높으면 긍정 인사이트', async () => {
    setupQueryMock({
      'this_week.*last_week': [{ this_rate: 82, last_rate: 65 }],
    });

    const result = defined(await detectWeekComparison('2026-03-15'));
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

    const result = defined(await detectWeekComparison('2026-03-15'));
    expect(result.timing).toBe('night');
    expect(result.message).toContain('55%');
    expect(result.message).toContain('72%');
  });

  it('차이 <5%이면 null', async () => {
    setupQueryMock({
      'this_week.*last_week': [{ this_rate: 72, last_rate: 70 }],
    });

    const result = await detectWeekComparison('2026-03-15');
    expect(result).toBeNull();
  });

  it('한 주라도 데이터 없으면 null', async () => {
    setupQueryMock({
      'this_week.*last_week': [{ this_rate: 72, last_rate: null }],
    });

    const result = await detectWeekComparison('2026-03-15');
    expect(result).toBeNull();
  });
});

// ─── detectOverdue ────────────────────────────────────────

describe('detectOverdue', () => {
  it('밀린 일정 3건 이상이면 감지', async () => {
    setupQueryMock({
      "status = 'todo'.*date < ": [{ overdue_count: 5 }],
    });

    const result = defined(await detectOverdue('2026-03-15'));
    expect(result.type).toBe('overdueAlert');
    expect(result.timing).toBe('morning');
    expect(result.priority).toBe(7);
    expect(result.message).toContain('5건');
  });

  it('밀린 일정 2건이면 null', async () => {
    setupQueryMock({
      "status = 'todo'.*date < ": [{ overdue_count: 2 }],
    });

    const result = await detectOverdue('2026-03-15');
    expect(result).toBeNull();
  });

  it('밀린 일정 0건이면 null', async () => {
    setupQueryMock({
      "status = 'todo'.*date < ": [{ overdue_count: 0 }],
    });

    const result = await detectOverdue('2026-03-15');
    expect(result).toBeNull();
  });
});

// ─── pickMorningNudge / pickNightNudge ────────────────────

describe('pickMorningNudge', () => {
  it('아침 타이밍 인사이트만 선택', async () => {
    setupQueryMock({
      // streak: morning
      'grp = 0': [{ name: '유산균 먹기', streak: '5' }],
      // overdue: morning, priority 7
      "status = 'todo'.*date < ": [{ overdue_count: 4 }],
      // slotGap: night only → 아침에 선택 안 됨
      'time_slot.*GROUP BY.*time_slot.*HAVING': [
        { time_slot: '낮', total: '14', done: '14', rate: 100 },
        { time_slot: '밤', total: '12', done: '2', rate: 17 },
      ],
    });

    const result = await pickMorningNudge('2026-03-15');
    expect(result).not.toBeNull();
    // overdue(7) > streak 5일(10) → streak이 높음
    expect(result).toContain('유산균 먹기');
  });

  it('아침 타이밍에 밤 전용 인사이트는 제외', async () => {
    // slotGap은 night only
    setupQueryMock({
      'time_slot.*GROUP BY.*time_slot.*HAVING': [
        { time_slot: '낮', total: '14', done: '14', rate: 100 },
        { time_slot: '밤', total: '12', done: '2', rate: 17 },
      ],
    });

    const result = await pickMorningNudge('2026-03-15');
    // slotGap은 night only → 아침에는 null
    expect(result).toBeNull();
  });

  it('모든 감지가 임계값 미달이면 null', async () => {
    setupQueryMock();

    const result = await pickMorningNudge('2026-03-15');
    expect(result).toBeNull();
  });
});

describe('pickNightNudge', () => {
  it('밤 타이밍 인사이트만 선택', async () => {
    setupQueryMock({
      // sleepTrend: night, priority 8
      'sleep_type.*night.*ORDER BY date DESC.*LIMIT 3': [
        { date: '2026-03-15', duration_minutes: 300 },
        { date: '2026-03-14', duration_minutes: 360 },
        { date: '2026-03-13', duration_minutes: 420 },
      ],
      // slotGap: night, priority 5
      'time_slot.*GROUP BY.*time_slot.*HAVING': [
        { time_slot: '낮', total: '14', done: '14', rate: 100 },
        { time_slot: '밤', total: '12', done: '2', rate: 17 },
      ],
    });

    const result = await pickNightNudge('2026-03-15');
    expect(result).not.toBeNull();
    // sleepTrend(8) > slotGap(5)
    expect(result).toContain('줄고');
  });

  it('모든 감지가 임계값 미달이면 null', async () => {
    setupQueryMock();

    const result = await pickNightNudge('2026-03-15');
    expect(result).toBeNull();
  });
});

// ─── DB 오류 처리 ─────────────────────────────────────────

describe('에러 처리', () => {
  it('DB 오류 시 각 감지 함수는 null 반환', async () => {
    mockQuery.mockRejectedValue(new Error('DB connection lost'));

    expect(await detectStreak('2026-03-15')).toBeNull();
    expect(await detectSleepTrend('2026-03-15')).toBeNull();
    expect(await detectSlotGap('2026-03-15')).toBeNull();
    expect(await detectWeekComparison('2026-03-15')).toBeNull();
    expect(await detectOverdue('2026-03-15')).toBeNull();
  });

  it('DB 오류 시 pickMorningNudge는 null 반환', async () => {
    mockQuery.mockRejectedValue(new Error('DB connection lost'));

    const result = await pickMorningNudge('2026-03-15');
    expect(result).toBeNull();
  });
});
