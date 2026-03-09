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

// KST 모킹 — 고정된 날짜
vi.mock('../kst.js', () => ({
  getTodayISO: () => '2026-03-09',
  getYesterdayISO: () => '2026-03-08',
  getTodayString: () => '2026-03-09 (월)',
  getWeekReference: () => '',
}));

import { connectDB } from '../db.js';
import { buildLifeContext } from '../life-context.js';

beforeEach(async () => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue({ release: vi.fn() });
  await connectDB('postgresql://test@localhost/test');
});

// ─── SQL 패턴 기반 응답 매핑 ─────────────────────────────

type MockRow = Record<string, unknown>;

/** SQL 내용에 따라 적절한 응답을 반환하는 헬퍼 */
const setupQueryMock = (overrides: Record<string, MockRow[]> = {}): void => {
  const defaultResponses: Record<string, MockRow[]> = {
    // sleep
    'sleep_type.*night.*date IN': [],
    'AVG.*duration_minutes': [],
    'rn <= 3.*bedtime': [{ cnt: '0' }],
    'sleep_type.*nap.*date =': [{ nap_count: '0' }],
    // routine
    'routine_records.*routine_templates.*date =': [],
    'AVG.*daily_rate': [],
    // schedule
    "status != 'cancelled'.*end_date.*\\$1\\)": [{ total: '0', incomplete: '0' }],
    'date.*\\+ 1.*end_date': [{ count: '0' }],
    "status = 'todo'.*date < ": [{ count: '0' }],
    "date IS NULL.*status = 'todo'": [{ count: '0' }],
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

// ─── buildLifeContext ────────────────────────────────────

describe('buildLifeContext', () => {
  it('데이터가 전혀 없으면 수면 미기록만 포함', async () => {
    setupQueryMock();

    const result = await buildLifeContext('conversation');
    expect(result).toContain('현재 생활 맥락');
    expect(result).toContain('수면: 어젯밤 수면 기록 없음');
  });

  it('수면 데이터가 있으면 시간/취침시각 표시', async () => {
    setupQueryMock({
      'sleep_type.*night.*date IN': [
        { date: '2026-03-09', bedtime: '01:30', wake_time: '07:00', duration_minutes: 330, sleep_type: 'night' },
      ],
      'AVG.*duration_minutes': [{ avg_duration: '360', avg_bedtime_hour: '25.5', count: '5' }],
      'rn <= 3.*bedtime': [{ cnt: '3' }],
      'sleep_type.*nap.*date =': [{ nap_count: '1' }],
      'routine_records.*routine_templates.*date =': [{ total: '8', completed: '3' }],
      'AVG.*daily_rate': [{ avg_rate: '72' }],
      "status != 'cancelled'.*end_date.*\\$1\\)": [{ total: '5', incomplete: '3' }],
      'date.*\\+ 1.*end_date': [{ count: '2' }],
      "status = 'todo'.*date < ": [{ count: '1' }],
      "date IS NULL.*status = 'todo'": [{ count: '13' }],
    });

    const result = await buildLifeContext('conversation');

    // 수면
    expect(result).toContain('5시간 30분');
    expect(result).toContain('01:30~07:00');
    expect(result).toContain('7일 평균 6시간');
    expect(result).toContain('3일 연속 자정 이후 취침');
    expect(result).toContain('낮잠 1회');

    // 루틴
    expect(result).toContain('오늘 3/8 완료 (38%)');
    expect(result).toContain('7일 평균 72%');

    // 일정
    expect(result).toContain('오늘 5건');
    expect(result).toContain('미완료 3건');
    expect(result).toContain('내일 2건');
    expect(result).toContain('밀린 일정 1건');
    expect(result).toContain('백로그 13건');
  });

  it('morning 타이밍에는 루틴이 어제 기준, 낮잠 생략', async () => {
    setupQueryMock({
      'sleep_type.*night.*date IN': [
        { date: '2026-03-08', bedtime: '23:30', wake_time: '07:00', duration_minutes: 450, sleep_type: 'night' },
      ],
      'AVG.*duration_minutes': [{ avg_duration: '420', avg_bedtime_hour: '23.5', count: '3' }],
      'rn <= 3.*bedtime': [{ cnt: '0' }],
      'routine_records.*routine_templates.*date =': [{ total: '10', completed: '8' }],
      'AVG.*daily_rate': [{ avg_rate: '75' }],
      "status != 'cancelled'.*end_date.*\\$1\\)": [{ total: '3', incomplete: '3' }],
      "date IS NULL.*status = 'todo'": [{ count: '5' }],
    });

    const result = await buildLifeContext('morning');

    // morning에서는 '어제' 기준 루틴
    expect(result).toContain('어제 8/10 완료 (80%)');
    // 낮잠 없음 (morning에서는 조회 안 함)
    expect(result).not.toContain('낮잠');
    // 수면 OK면 자정 이후 취침 미표시
    expect(result).not.toContain('자정 이후');
    // 백로그 있음
    expect(result).toContain('백로그 5건');
  });

  it('수면 미기록 + morning이면 "수면 미기록" 표시', async () => {
    setupQueryMock();

    const result = await buildLifeContext('morning');
    expect(result).toContain('수면 미기록');
  });

  it('일정이 모두 완료면 미완료 수 생략', async () => {
    setupQueryMock({
      "status != 'cancelled'.*end_date.*\\$1\\)": [{ total: '3', incomplete: '0' }],
    });

    const result = await buildLifeContext('conversation');
    expect(result).toContain('오늘 3건');
    expect(result).not.toContain('미완료');
  });

  it('백로그가 있으면 백로그 건수 표시', async () => {
    setupQueryMock({
      "date IS NULL.*status = 'todo'": [{ count: '7' }],
    });

    const result = await buildLifeContext('conversation');
    expect(result).toContain('백로그 7건');
  });

  it('DB 오류 시 빈 문자열 반환', async () => {
    mockQuery.mockRejectedValue(new Error('DB connection lost'));

    const result = await buildLifeContext('conversation');
    expect(result).toBe('');
  });
});
