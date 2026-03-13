import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── 순수 유틸 테스트 ──

import { timeToCron, calcRoutineStats, RELOAD_DEBOUNCE_MS } from '../life-cron.js';

describe('timeToCron', () => {
  it('HH:MM → 크론 표현식', () => {
    expect(timeToCron('09:00')).toBe('0 9 * * *');
    expect(timeToCron('13:30')).toBe('30 13 * * *');
    expect(timeToCron('22:05')).toBe('5 22 * * *');
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
import { CronScheduler, type LifeCronConfig } from '../life-cron.js';

/** notification_settings 쿼리 mock 설정 */
const setupSettingsMock = (settings: Array<{ slot_name: string; label: string; time_value: string; active: boolean }> = []): void => {
  mockQuery.mockImplementation((sql: string) => {
    if (/notification_settings/.test(sql)) {
      return Promise.resolve({ rows: settings });
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

    setupSettingsMock([
      { slot_name: 'morning', label: '아침', time_value: '09:00', active: true },
    ]);

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
    setupSettingsMock([
      { slot_name: 'morning', label: '아침', time_value: '09:30', active: true },
    ]);
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
    const settingsQueries = mockQuery.mock.calls.filter(
      (call) => /notification_settings/.test(call[0] as string),
    );
    expect(settingsQueries).toHaveLength(1);
  });

  it('destroy() 시 pending debounce 타이머 정리', () => {
    scheduler.reload();
    scheduler.destroy();

    // destroy 후 타이머 경과해도 실행 안 됨
    vi.advanceTimersByTime(RELOAD_DEBOUNCE_MS * 2);

    // destroy 시점 이후 notification_settings 쿼리 없음
    const settingsQueries = mockQuery.mock.calls.filter(
      (call) => /notification_settings/.test(call[0] as string),
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
