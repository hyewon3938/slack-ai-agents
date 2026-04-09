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
    // sleep (night + morning naps)
    "sleep_type = 'night' OR": [],
    'AVG.*duration_minutes': [],
    'AS is_late': [],
    'bedtime.*>= \'12:00\'': [{ nap_count: '0' }],
    // routine
    'routine_records.*routine_templates.*date =': [],
    'AVG.*daily_rate': [],
    // schedule
    "status != 'cancelled'.*end_date.*\\$2\\)": [{ total: '0', incomplete: '0' }],
    'date.*\\+ 1.*end_date': [{ count: '0' }],
    "status = 'todo'.*date < ": [{ count: '0' }],
    "date IS NULL.*status = 'todo'": [{ count: '0' }],
    // diary
    'diary_entries.*date IN': [],
    // life_themes
    'life_themes.*active': [],
    // fortune
    'fortune_analyses.*daily': [],
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
  it('수면 데이터 없으면 수면 항목 생략 (conversation)', async () => {
    setupQueryMock();

    const result = await buildLifeContext('conversation', 1);
    expect(result).not.toContain('수면:');
  });

  it('수면 데이터가 있으면 시간/취침시각 표시', async () => {
    setupQueryMock({
      "sleep_type = 'night' OR": [
        { date: '2026-03-09', bedtime: '01:30', wake_time: '07:00', duration_minutes: 330, sleep_type: 'night' },
      ],
      'AVG.*duration_minutes': [{ avg_duration: '360', avg_bedtime_hour: '25.5', count: '5' }],
      'AS is_late': [
        { date: '2026-03-09', is_late: true },
        { date: '2026-03-08', is_late: true },
        { date: '2026-03-07', is_late: true },
      ],
      'bedtime.*>= \'12:00\'': [{ nap_count: '1' }],
      'routine_records.*routine_templates.*date =': [{ total: '8', completed: '3' }],
      'AVG.*daily_rate': [{ avg_rate: '72' }],
      "status != 'cancelled'.*end_date.*\\$2\\)": [{ total: '5', incomplete: '3' }],
      'date.*\\+ 1.*end_date': [{ count: '2' }],
      "status = 'todo'.*date < ": [{ count: '1' }],
      "date IS NULL.*status = 'todo'": [{ count: '13' }],
    });

    const result = await buildLifeContext('conversation', 1);

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
      "sleep_type = 'night' OR": [
        { date: '2026-03-08', bedtime: '23:30', wake_time: '07:00', duration_minutes: 450, sleep_type: 'night' },
      ],
      'AVG.*duration_minutes': [{ avg_duration: '420', avg_bedtime_hour: '23.5', count: '3' }],
      'AS is_late': [{ date: '2026-03-08', is_late: false }],
      'routine_records.*routine_templates.*date =': [{ total: '10', completed: '8' }],
      'AVG.*daily_rate': [{ avg_rate: '75' }],
      "status != 'cancelled'.*end_date.*\\$2\\)": [{ total: '3', incomplete: '3' }],
      "date IS NULL.*status = 'todo'": [{ count: '5' }],
    });

    const result = await buildLifeContext('morning', 1);

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

    const result = await buildLifeContext('morning', 1);
    expect(result).toContain('수면 미기록');
  });

  it('일정이 모두 완료면 미완료 수 생략', async () => {
    setupQueryMock({
      "status != 'cancelled'.*end_date.*\\$2\\)": [{ total: '3', incomplete: '0' }],
    });

    const result = await buildLifeContext('conversation', 1);
    expect(result).toContain('오늘 3건');
    expect(result).not.toContain('미완료');
  });

  it('백로그가 있으면 백로그 건수 표시', async () => {
    setupQueryMock({
      "date IS NULL.*status = 'todo'": [{ count: '7' }],
    });

    const result = await buildLifeContext('conversation', 1);
    expect(result).toContain('백로그 7건');
  });

  // ─── 연속 자정 이후 취침 패턴 ─────────────────────────

  it('연속 자정 이후 취침: 실제 연속일 때만 표시', async () => {
    setupQueryMock({
      'AS is_late': [
        { date: '2026-03-09', is_late: true },
        { date: '2026-03-08', is_late: true },
        { date: '2026-03-07', is_late: false },
      ],
    });

    const result = await buildLifeContext('conversation', 1);
    expect(result).toContain('2일 연속 자정 이후 취침');
  });

  it('연속 자정 이후 취침: 첫 기록이 늦지 않으면 미표시', async () => {
    setupQueryMock({
      'AS is_late': [
        { date: '2026-03-09', is_late: false },
        { date: '2026-03-08', is_late: true },
        { date: '2026-03-07', is_late: true },
      ],
    });

    const result = await buildLifeContext('conversation', 1);
    expect(result).not.toContain('자정 이후');
  });

  it('연속 자정 이후 취침: 1일만이면 미표시', async () => {
    setupQueryMock({
      'AS is_late': [
        { date: '2026-03-09', is_late: true },
        { date: '2026-03-08', is_late: false },
      ],
    });

    const result = await buildLifeContext('conversation', 1);
    expect(result).not.toContain('자정 이후');
  });

  // ─── 일기/테마/운세 맥락 ──────────────────────────────

  it('일기 데이터가 있으면 일기 맥락 포함', async () => {
    setupQueryMock({
      'diary_entries.*date IN': [
        { date: '2026-03-09', content: '오늘 면접 봤는데 긴장했다.' },
      ],
    });

    const result = await buildLifeContext('conversation', 1);
    expect(result).toContain('일기:');
    expect(result).toContain('오늘: 오늘 면접 봤는데 긴장했다.');
  });

  it('일기 200자 초과 시 잘림', async () => {
    setupQueryMock({
      'diary_entries.*date IN': [
        { date: '2026-03-09', content: 'A'.repeat(250) },
      ],
    });

    const result = await buildLifeContext('conversation', 1);
    expect(result).toContain('...');
  });

  it('테마 데이터가 있으면 삶의 테마 맥락 포함', async () => {
    setupQueryMock({
      'life_themes.*active': [
        { theme: '이직 준비', category: 'career', detail: '기술 면접 준비 중' },
      ],
    });

    const result = await buildLifeContext('conversation', 1);
    expect(result).toContain('삶의 테마:');
    expect(result).toContain('[career] 이직 준비: 기술 면접 준비 중');
  });

  it('운세 데이터가 있으면 운세 맥락 포함', async () => {
    setupQueryMock({
      'fortune_analyses.*daily': [
        { summary: '편관 운이 들어오는 날', advice: '무리하지 마' },
      ],
    });

    const result = await buildLifeContext('conversation', 1);
    expect(result).toContain('오늘 운세:');
    expect(result).toContain('편관 운이 들어오는 날');
    expect(result).toContain('조언: 무리하지 마');
  });

  it('DB 오류 시 빈 문자열 반환', async () => {
    mockQuery.mockRejectedValue(new Error('DB connection lost'));

    const result = await buildLifeContext('conversation', 1);
    expect(result).toBe('');
  });
});
