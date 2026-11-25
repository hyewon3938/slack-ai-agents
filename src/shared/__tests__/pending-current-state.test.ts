import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatDateShort } from '../kst.js';

// loadCurrentStateBlocks — 테이블 종류별 조회 분기와 조회 대상(날짜·유저) 선택만 고정한다.

const TODAY = '2026-03-08';

const mockQueryTodaySchedules = vi.fn();
const mockQueryBacklogSchedules = vi.fn();
const mockQueryTodayRecords = vi.fn();
const mockQueryActiveTemplates = vi.fn();
const mockQuerySleepForHome = vi.fn();
const mockQuerySleepEventsForHome = vi.fn();
const mockQuery = vi.fn();

vi.mock('../kst.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../kst.js')>()),
  getTodayISO: (): string => TODAY,
}));

vi.mock('../life/queries-schedule.js', () => ({
  queryTodaySchedules: (...args: unknown[]): unknown => mockQueryTodaySchedules(...args),
  queryBacklogSchedules: (...args: unknown[]): unknown => mockQueryBacklogSchedules(...args),
}));

vi.mock('../life/queries-routine.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../life/queries-routine.js')>()),
  queryTodayRecords: (...args: unknown[]): unknown => mockQueryTodayRecords(...args),
  queryActiveTemplates: (...args: unknown[]): unknown => mockQueryActiveTemplates(...args),
}));

vi.mock('../life/queries-sleep.js', () => ({
  querySleepForHome: (...args: unknown[]): unknown => mockQuerySleepForHome(...args),
  querySleepEventsForHome: (...args: unknown[]): unknown => mockQuerySleepEventsForHome(...args),
}));

vi.mock('../db.js', () => ({
  query: (...args: unknown[]): unknown => mockQuery(...args),
}));

const { loadCurrentStateBlocks } = await import('../pending-current-state.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockQueryTodaySchedules.mockResolvedValue([]);
  mockQueryBacklogSchedules.mockResolvedValue([]);
  mockQueryTodayRecords.mockResolvedValue([]);
  mockQueryActiveTemplates.mockResolvedValue([]);
  mockQuerySleepForHome.mockResolvedValue([]);
  mockQuerySleepEventsForHome.mockResolvedValue([]);
  mockQuery.mockResolvedValue({ rows: [] });
});

describe('loadCurrentStateBlocks — schedules', () => {
  it('영향받은 날짜 중 첫 날짜의 일정을 조회', async () => {
    const result = await loadCurrentStateBlocks('schedules', {
      userId: 7,
      affectedDates: ['2026-03-05', '2026-03-06'],
    });
    expect(mockQueryTodaySchedules).toHaveBeenCalledWith('2026-03-05', 7);
    expect(mockQueryBacklogSchedules).not.toHaveBeenCalled();
    expect(result?.text).toContain(`${formatDateShort('2026-03-05')} 일정`);
  });

  it('영향받은 날짜가 없으면 오늘 일정을 조회', async () => {
    await loadCurrentStateBlocks('schedules', { userId: 7, affectedDates: [] });
    expect(mockQueryTodaySchedules).toHaveBeenCalledWith(TODAY, 7);
  });

  it('날짜가 빈 값인 항목이 있으면 백로그를 조회', async () => {
    const result = await loadCurrentStateBlocks('schedules', {
      userId: 7,
      affectedDates: ['', '2026-03-05'],
    });
    expect(mockQueryBacklogSchedules).toHaveBeenCalledWith(7);
    expect(mockQueryTodaySchedules).not.toHaveBeenCalled();
    expect(result?.text).toContain('백로그');
  });
});

describe('loadCurrentStateBlocks — 날짜 기준 테이블', () => {
  it('routine_records는 첫 영향 날짜의 루틴 기록을 조회', async () => {
    await loadCurrentStateBlocks('routine_records', {
      userId: 7,
      affectedDates: ['2026-03-05'],
    });
    expect(mockQueryTodayRecords).toHaveBeenCalledWith('2026-03-05', 7);
  });

  it('routine_records는 영향 날짜가 없으면 오늘 기준', async () => {
    await loadCurrentStateBlocks('routine_records', { userId: 7 });
    expect(mockQueryTodayRecords).toHaveBeenCalledWith(TODAY, 7);
  });

  it.each(['sleep_records', 'sleep_events'])(
    '%s는 첫 영향 날짜의 수면 기록과 이벤트를 함께 조회',
    async (table) => {
      const result = await loadCurrentStateBlocks(table, {
        userId: 7,
        affectedDates: ['2026-03-05'],
      });
      expect(mockQuerySleepForHome).toHaveBeenCalledWith('2026-03-05', 7);
      expect(mockQuerySleepEventsForHome.mock.calls[0]?.[0]).toBe('2026-03-05');
      expect(result?.text).toBe('2026-03-05 수면 기록');
    },
  );
});

describe('loadCurrentStateBlocks — 목록 테이블', () => {
  it('routine_templates는 유저의 활성 루틴을 이름·시간대로 나열', async () => {
    mockQueryActiveTemplates.mockResolvedValue([
      { id: 1, name: '스트레칭', time_slot: '아침' },
      { id: 2, name: '독서', time_slot: '밤' },
    ]);
    const result = await loadCurrentStateBlocks('routine_templates', { userId: 7 });
    expect(mockQueryActiveTemplates).toHaveBeenCalledWith(7);
    expect(result?.text).toBe('활성 루틴 2개');
    expect(result?.blocks).toEqual([
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*활성 루틴* (2개)\n• 스트레칭 (아침)\n• 독서 (밤)' },
      },
    ]);
  });

  it('custom_instructions는 해당 유저 기준으로 조회', async () => {
    await loadCurrentStateBlocks('custom_instructions', { userId: 7 });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([7]);
  });
});

describe('loadCurrentStateBlocks — 미지원 테이블', () => {
  it('지원하지 않는 테이블이면 아무것도 조회하지 않고 null', async () => {
    const result = await loadCurrentStateBlocks('budget_expenses', { userId: 7 });
    expect(result).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQueryTodaySchedules).not.toHaveBeenCalled();
  });
});
