import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── pg 모듈 모킹 ──

const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn();

vi.mock('pg', () => {
  const MockPool = vi.fn(function (this: Record<string, unknown>) {
    this.query = mockQuery;
    this.connect = mockConnect;
    this.end = mockEnd;
  });
  return { default: { Pool: MockPool } };
});

// connectDB 후에야 query()가 동작하므로 먼저 연결
import { connectDB } from '../db.js';
import {
  shouldCreateToday,
  frequencyBadge,
  queryActiveTemplates,
  queryTodayRecords,
  queryExistingTemplateIds,
  queryLastRecordDate,
  createRecord,
  completeRecord,
  queryTodaySchedules,
  updateScheduleStatus,
  postponeSchedule,
} from '../life-queries.js';

beforeEach(async () => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue({ release: vi.fn() });
  await connectDB('postgresql://test@localhost/test');
});

// ─── shouldCreateToday ─────────────────────────────────

describe('shouldCreateToday', () => {
  it('매일은 항상 true', () => {
    expect(shouldCreateToday('매일', '2026-03-07', '2026-03-08')).toBe(true);
    expect(shouldCreateToday('매일', null, '2026-03-08')).toBe(true);
  });

  it('lastDate가 null이면 항상 true', () => {
    expect(shouldCreateToday('격일', null, '2026-03-08')).toBe(true);
    expect(shouldCreateToday('주1회', null, '2026-03-08')).toBe(true);
  });

  it('격일: 2일 이상 경과 시 true', () => {
    expect(shouldCreateToday('격일', '2026-03-06', '2026-03-08')).toBe(true);
    expect(shouldCreateToday('격일', '2026-03-07', '2026-03-08')).toBe(false);
  });

  it('3일마다: 3일 이상 경과 시 true', () => {
    expect(shouldCreateToday('3일마다', '2026-03-05', '2026-03-08')).toBe(true);
    expect(shouldCreateToday('3일마다', '2026-03-06', '2026-03-08')).toBe(false);
  });

  it('주1회: 7일 이상 경과 시 true', () => {
    expect(shouldCreateToday('주1회', '2026-03-01', '2026-03-08')).toBe(true);
    expect(shouldCreateToday('주1회', '2026-03-03', '2026-03-08')).toBe(false);
  });

  it('알 수 없는 빈도는 true', () => {
    expect(shouldCreateToday('unknown', '2026-03-07', '2026-03-08')).toBe(true);
  });
});

// ─── frequencyBadge ────────────────────────────────────

describe('frequencyBadge', () => {
  it('매일이면 빈 문자열', () => {
    expect(frequencyBadge('매일')).toBe('');
  });

  it('격일이면 배지 반환', () => {
    expect(frequencyBadge('격일')).toContain('2일');
  });

  it('3일마다면 배지 반환', () => {
    expect(frequencyBadge('3일마다')).toContain('3일');
  });

  it('주1회면 배지 반환', () => {
    expect(frequencyBadge('주1회')).toContain('1주');
  });
});

// ─── 루틴 쿼리 ─────────────────────────────────────────

describe('queryActiveTemplates', () => {
  it('활성 템플릿 조회 SQL 실행', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, name: '운동', time_slot: '아침', frequency: '매일' }],
    });

    const result = await queryActiveTemplates();
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('운동');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('routine_templates'),
      undefined,
    );
  });
});

describe('queryTodayRecords', () => {
  it('JOIN 쿼리로 레코드 + 템플릿 정보 조회', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 1, template_id: 10, date: '2026-03-08', completed: false,
        name: '운동', time_slot: '아침', frequency: '매일',
      }],
    });

    const result = await queryTodayRecords('2026-03-08');
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('운동');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('JOIN routine_templates'),
      ['2026-03-08'],
    );
  });
});

describe('queryExistingTemplateIds', () => {
  it('이미 생성된 기록의 template_id 집합 반환', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ template_id: 1 }, { template_id: 3 }],
    });

    const result = await queryExistingTemplateIds('2026-03-08');
    expect(result).toBeInstanceOf(Set);
    expect(result.has(1)).toBe(true);
    expect(result.has(3)).toBe(true);
    expect(result.has(2)).toBe(false);
  });
});

describe('queryLastRecordDate', () => {
  it('마지막 기록 날짜 반환', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ date: '2026-03-06' }] });
    const result = await queryLastRecordDate(1);
    expect(result).toBe('2026-03-06');
  });

  it('기록 없으면 null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await queryLastRecordDate(999);
    expect(result).toBeNull();
  });
});

describe('createRecord', () => {
  it('INSERT 후 id 반환', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] });
    const id = await createRecord(1, '2026-03-08');
    expect(id).toBe(42);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO routine_records'),
      [1, '2026-03-08'],
    );
  });
});

describe('completeRecord', () => {
  it('UPDATE completed = true 실행', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await completeRecord(42);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('completed = true'),
      [42],
    );
  });
});

// ─── 일정 쿼리 ─────────────────────────────────────────

describe('queryTodaySchedules', () => {
  it('당일 + 기간 일정 조회', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, title: '회의', date: '2026-03-08', end_date: null, status: 'todo', category: '업무', memo: null }],
    });

    const result = await queryTodaySchedules('2026-03-08');
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('회의');
  });
});

describe('updateScheduleStatus', () => {
  it('상태 업데이트 SQL 실행', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await updateScheduleStatus(1, 'done');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE schedules'),
      ['done', 1],
    );
  });
});

describe('postponeSchedule', () => {
  it('날짜 변경 + status → todo', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await postponeSchedule(1, '2026-03-09');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'todo'"),
      ['2026-03-09', 1],
    );
  });
});
