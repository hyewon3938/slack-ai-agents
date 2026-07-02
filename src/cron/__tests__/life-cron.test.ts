import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── 순수 유틸 테스트 ──

import {
  timeToCron,
  calcRoutineStats,
  getBillingMonthForDate,
  RELOAD_DEBOUNCE_MS,
} from '../life-cron.js';

describe('timeToCron', () => {
  it('HH:MM → 크론 표현식', () => {
    expect(timeToCron('09:00')).toBe('0 9 * * *');
    expect(timeToCron('13:30')).toBe('30 13 * * *');
    expect(timeToCron('22:05')).toBe('5 22 * * *');
  });
});

// ── getBillingMonthForDate: 결제주기 경계 (웹 billing/cycle.ts와 15일 통일) ──

describe('getBillingMonthForDate — 결제주기 경계 15일', () => {
  it('14일 → 당월 (경계 직전)', () => {
    expect(getBillingMonthForDate('2026-07-14')).toBe('2026-07');
  });

  it('15일 → 다음 달 (경계 당일, 기존 16일 버그 케이스)', () => {
    expect(getBillingMonthForDate('2026-07-15')).toBe('2026-08');
  });

  it('16일 → 다음 달', () => {
    expect(getBillingMonthForDate('2026-07-16')).toBe('2026-08');
  });

  it('12월 15일 → 연 넘김 (다음 해 1월)', () => {
    expect(getBillingMonthForDate('2026-12-15')).toBe('2027-01');
  });
});

describe('calcRoutineStats', () => {
  it('빈 배열', () => {
    const stats = calcRoutineStats([]);
    expect(stats.total).toBe(0);
    expect(stats.rate).toBe(0);
    expect(stats.weakestSlot).toBeNull();
  });
});

// ── CronScheduler reload debounce/mutex 테스트 ──

// vi.hoisted로 mock 함수 선언 (vi.mock 호이스팅 대응)
const { mockSchedule, mockQuery, mockConnect } = vi.hoisted(() => ({
  mockSchedule: vi.fn(() => ({ stop: vi.fn() })),
  mockQuery: vi.fn(),
  mockConnect: vi.fn(),
}));

// node-cron mock
vi.mock('node-cron', () => ({
  default: { schedule: mockSchedule },
}));

// DB mock
vi.mock('pg', () => {
  const MockPool = vi.fn(function (this: Record<string, unknown>) {
    this.query = mockQuery;
    this.connect = mockConnect;
    this.end = vi.fn();
  });
  return { default: { Pool: MockPool, types: { setTypeParser: vi.fn() } } };
});

vi.mock('../../shared/kst.js', () => ({
  getTodayISO: () => '2026-03-12',
  getYesterdayISO: () => '2026-03-11',
  getKSTTimeString: () => '09:00',
  getKSTDayOfWeek: () => 4,
  formatDateShort: (d: string) => d,
  addDays: (d: string, n: number) => {
    const date = new Date(`${d}T12:00:00+09:00`);
    date.setUTCDate(date.getUTCDate() + n);
    return date.toISOString().slice(0, 10);
  },
}));

import { connectDB } from '../../shared/db.js';
import {
  CronScheduler,
  createTodayRecords,
  calcYesterdayFlexSpent,
  type LifeCronConfig,
} from '../life-cron.js';
import type { UserMapping } from '../../shared/user-resolver.js';

/** notification_settings 쿼리 mock 설정 */
const setupSettingsMock = (
  settings: Array<{ slot_name: string; label: string; time_value: string; active: boolean }> = [],
  mappings: UserMapping[] = [],
): void => {
  mockQuery.mockImplementation((sql: string) => {
    if (/notification_settings/.test(sql)) {
      return Promise.resolve({ rows: settings });
    }
    if (/slack_user_mappings/.test(sql)) {
      return Promise.resolve({
        rows: mappings.map((m) => ({
          user_id: m.userId,
          slack_user_id: m.slackUserId,
          life_channel_id: m.lifeChannelId,
          insight_channel_id: m.insightChannelId,
        })),
      });
    }
    if (/reminders/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
};

const createMockApp = (): unknown => ({
  client: {
    chat: { postMessage: vi.fn().mockResolvedValue({}) },
  },
});

describe('CronScheduler reload debounce', () => {
  let scheduler: CronScheduler;
  let stopFns: Array<ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockConnect.mockResolvedValue({ release: vi.fn() });

    // 각 schedule() 호출마다 고유한 stop 함수를 반환
    stopFns = [];
    mockSchedule.mockImplementation(() => {
      const stop = vi.fn();
      stopFns.push(stop);
      return { stop };
    });

    await connectDB('postgresql://test@localhost/test');

    setupSettingsMock([{ slot_name: 'morning', label: '아침', time_value: '09:00', active: true }]);

    const app = createMockApp();
    const config: LifeCronConfig = {
      channelId: 'C123',
      llmClient: {} as LifeCronConfig['llmClient'],
    };

    scheduler = new CronScheduler(app as never, config);
    await scheduler.init();

    // init 후 상태 초기화 (쿼리 카운트 리셋)
    mockQuery.mock.calls.length = 0;

    // 리로드용 settings mock 재설정
    setupSettingsMock([{ slot_name: 'morning', label: '아침', time_value: '09:30', active: true }]);
  });

  afterEach(() => {
    scheduler.destroy();
    vi.useRealTimers();
  });

  it('연속 reload() 호출 → debounce로 1회만 실행', async () => {
    // 5회 연속 호출 (agent loop에서 modify_db 5번)
    scheduler.reload();
    scheduler.reload();
    scheduler.reload();
    scheduler.reload();
    scheduler.reload();

    // debounce 전에는 실행 안 됨
    expect(mockQuery).not.toHaveBeenCalled();

    // debounce 시간 경과
    await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS);

    // loadAndSchedule 1회만 실행됨 (notification_settings 쿼리 1회)
    const settingsQueries = mockQuery.mock.calls.filter((call) =>
      /notification_settings/.test(call[0] as string),
    );
    expect(settingsQueries).toHaveLength(1);
  });

  it('destroy() 시 pending debounce 타이머 정리', () => {
    scheduler.reload();
    scheduler.destroy();

    // destroy 후 타이머 경과해도 실행 안 됨
    vi.advanceTimersByTime(RELOAD_DEBOUNCE_MS * 2);

    // destroy 시점 이후 notification_settings 쿼리 없음
    const settingsQueries = mockQuery.mock.calls.filter((call) =>
      /notification_settings/.test(call[0] as string),
    );
    expect(settingsQueries).toHaveLength(0);
  });

  it('reload 시 기존 task의 stop()이 호출됨', async () => {
    // init에서 생성된 stop 함수들 기억
    const initStopFns = [...stopFns];
    expect(initStopFns.length).toBeGreaterThan(0);

    scheduler.reload();
    await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS);

    // destroyAll에서 init 시 생성된 task들의 stop()이 호출됨
    for (const stop of initStopFns) {
      expect(stop).toHaveBeenCalled();
    }
  });
});

// ── createTodayRecords: start_date 가드 ──

describe('createTodayRecords — 매일 빈도 start_date 가드', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ release: vi.fn() });
    await connectDB('postgresql://test@localhost/test');
  });

  const setupTemplateMock = (template: {
    id: number;
    name: string;
    time_slot: string;
    frequency: string;
    start_date: string;
  }): void => {
    mockQuery.mockImplementation((sql: string) => {
      if (/FROM routine_templates/.test(sql)) {
        return Promise.resolve({ rows: [template] });
      }
      if (/SELECT template_id FROM routine_records/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      if (/INSERT INTO routine_records/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 1 }] });
      }
      return Promise.resolve({ rows: [] });
    });
  };

  it('매일 빈도 + start_date 미래 → 기록 생성하지 않음', async () => {
    setupTemplateMock({
      id: 99,
      name: '미래 루틴',
      time_slot: '낮',
      frequency: '매일',
      start_date: '2026-04-21',
    });

    const created = await createTodayRecords('2026-04-20', 1);
    expect(created).toBe(0);

    const inserts = mockQuery.mock.calls.filter((call) =>
      /INSERT INTO routine_records/.test(call[0] as string),
    );
    expect(inserts).toHaveLength(0);
  });

  it('매일 빈도 + start_date = 오늘 → 기록 생성', async () => {
    setupTemplateMock({
      id: 99,
      name: '오늘 시작',
      time_slot: '낮',
      frequency: '매일',
      start_date: '2026-04-21',
    });

    const created = await createTodayRecords('2026-04-21', 1);
    expect(created).toBe(1);
  });

  it('매일 빈도 + start_date 과거 → 기록 생성', async () => {
    setupTemplateMock({
      id: 99,
      name: '진행 중',
      time_slot: '밤',
      frequency: '매일',
      start_date: '2026-04-01',
    });

    const created = await createTodayRecords('2026-04-21', 1);
    expect(created).toBe(1);
  });
});

// ── calcYesterdayFlexSpent: 웹 readTodayFlexSpent SSOT 정합 ──
// spent = directFlex(어제, 비할부) + max(0, overflow(어제까지) - overflow(그제까지)).

describe('calcYesterdayFlexSpent — 웹 SSOT 정합', () => {
  const YESTERDAY = '2026-07-10';
  const DAY_BEFORE = '2026-07-09';
  const BILLING = '2026-07';

  beforeEach(async () => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ release: vi.fn() });
    await connectDB('postgresql://test@localhost/test');
  });

  /**
   * directFlex 쿼리(`date = $2::date`)와 overflow 쿼리(`planned_expenses`)를 구분해 mock.
   * overflow는 upToDate($3) 값에 따라 어제까지/그제까지 누적을 다르게 반환.
   */
  const setupSpentMock = (opts: {
    direct: number;
    overflowByDate: Record<string, number>;
  }): void => {
    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (/planned_expenses/.test(sql)) {
        const upTo = String(params?.[2] ?? '');
        const overflow = opts.overflowByDate[upTo] ?? 0;
        return Promise.resolve({ rows: [{ overflow: String(overflow) }] });
      }
      if (/date = \$2::date/.test(sql)) {
        return Promise.resolve({ rows: [{ total: String(opts.direct) }] });
      }
      return Promise.resolve({ rows: [] });
    });
  };

  it('(a) 일반 지출만 → directFlex 그대로, overflow 0', async () => {
    setupSpentMock({ direct: 12000, overflowByDate: {} });
    const spent = await calcYesterdayFlexSpent(1, YESTERDAY, BILLING);
    expect(spent).toBe(12000);
  });

  it('(b) 할부·예정연결·exclude는 directFlex SQL에서 제외 (WHERE 절 고정)', async () => {
    setupSpentMock({ direct: 0, overflowByDate: {} });
    await calcYesterdayFlexSpent(1, YESTERDAY, BILLING);

    const directCall = mockQuery.mock.calls.find((c) => /date = \$2::date/.test(c[0] as string));
    expect(directCall).toBeDefined();
    const directSql = directCall?.[0] as string;
    expect(directSql).toMatch(/is_installment = false/);
    expect(directSql).toMatch(/exclude_from_budget = false/);
    expect(directSql).toMatch(/planned_expense_id IS NULL/);
  });

  it('(c) 예정지출 초과 발생일 → overflow 증가분만 가산', async () => {
    // 그제까지 누적 초과 0, 어제까지 누적 초과 5000 → 증가분 5000
    setupSpentMock({
      direct: 3000,
      overflowByDate: { [DAY_BEFORE]: 0, [YESTERDAY]: 5000 },
    });
    const spent = await calcYesterdayFlexSpent(1, YESTERDAY, BILLING);
    expect(spent).toBe(8000); // 3000 + 5000
  });

  it('(c-2) 초과가 이미 그제 발생 → 어제 증가분 0 (중복 가산 방지)', async () => {
    setupSpentMock({
      direct: 3000,
      overflowByDate: { [DAY_BEFORE]: 5000, [YESTERDAY]: 5000 },
    });
    const spent = await calcYesterdayFlexSpent(1, YESTERDAY, BILLING);
    expect(spent).toBe(3000); // overflow 증가분 0
  });

  it('(d) overflow 감소(환불·조정) → max(0, ...)로 음수 방어', async () => {
    setupSpentMock({
      direct: 3000,
      overflowByDate: { [DAY_BEFORE]: 8000, [YESTERDAY]: 5000 },
    });
    const spent = await calcYesterdayFlexSpent(1, YESTERDAY, BILLING);
    expect(spent).toBe(3000); // max(0, 5000-8000)=0
  });
});
