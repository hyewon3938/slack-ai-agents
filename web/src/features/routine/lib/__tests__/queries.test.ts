import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import type { QueryResult } from '@/lib/db';
import {
  createRoutineTemplate,
  updateRoutineTemplate,
  ensureTodayRecords,
  queryRoutineStats,
  queryRoutinePerStats,
  queryRoutineHeatmap,
  createFreeRecord,
  deleteFreeRecord,
  deleteIncompleteScheduledRecordOn,
  deleteRecordsBefore,
  countCompletedRecordsBefore,
} from '../queries';

// ─── 합성 픽스처 (실제 개인 데이터 아님) ───────────────────────────────
// DB proxy는 fetch 기반이라 목킹 불가 → @/lib/db의 query/queryOne을 스텁하고
// 생성된 SQL·파라미터 배열(추적 모드 축·측정 격리 조건)을 검증한다. (#605, ADR-0061)

const TEMPLATE_ROW: Record<string, unknown> = {
  id: 1,
  name: '스트레칭',
  time_slot: '밤',
  frequency: '매일',
  active: true,
  tracking_mode: 'scheduled',
  start_date: '2026-07-01',
  created_at: '2026-07-01T00:00:00+09:00',
};

const FREE_RECORD_ROW: Record<string, unknown> = {
  id: 9,
  template_id: 1,
  date: '2026-07-26',
  completed: true,
  completed_at: '2026-07-26T10:00:00+09:00',
  memo: null,
  entry_type: 'free',
  name: '산책',
  time_slot: null,
  frequency: null,
};

const empty: QueryResult = { rows: [], rowCount: 0 };
const okDelete: QueryResult = { rows: [], rowCount: 1 };

function lastQueryOneCall(): [string, unknown[]] {
  const call = vi.mocked(queryOne).mock.calls.at(-1);
  if (!call) throw new Error('queryOne 미호출');
  return [call[0], (call[1] ?? []) as unknown[]];
}

function lastQueryCall(): [string, unknown[]] {
  const call = vi.mocked(query).mock.calls.at(-1);
  if (!call) throw new Error('query 미호출');
  return [call[0], (call[1] ?? []) as unknown[]];
}

function queryCallAt(index: number): [string, unknown[]] {
  const call = vi.mocked(query).mock.calls[index];
  if (!call) throw new Error(`query 호출 ${index}번 없음`);
  return [call[0], (call[1] ?? []) as unknown[]];
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ─── 템플릿 쓰기 — tracking_mode 축이 실제로 저장·반환되는지 ────────────

describe('createRoutineTemplate — tracking_mode 저장', () => {
  it('start_date 있는 갈래: tracking_mode 파라미터 + RETURNING 포함', async () => {
    vi.mocked(queryOne).mockResolvedValue(TEMPLATE_ROW);

    await createRoutineTemplate(7, {
      name: '산책',
      time_slot: null,
      frequency: null,
      start_date: '2026-07-01',
      tracking_mode: 'free',
    });

    const [sql, params] = lastQueryOneCall();
    expect(sql).toContain('INSERT INTO routine_templates');
    expect(sql).toContain('tracking_mode');
    expect(sql).toContain('RETURNING id, name, time_slot, frequency, active, tracking_mode');
    expect(params).toEqual([7, '산책', null, null, '2026-07-01', 'free']);
  });

  it('start_date 없는 갈래: 미지정이면 scheduled 기본값', async () => {
    vi.mocked(queryOne).mockResolvedValue(TEMPLATE_ROW);

    await createRoutineTemplate(7, { name: '스트레칭', time_slot: '밤', frequency: '매일' });

    const [sql, params] = lastQueryOneCall();
    expect(sql).toContain('tracking_mode');
    expect(params).toEqual([7, '스트레칭', '밤', '매일', 'scheduled']);
  });
});

describe('updateRoutineTemplate — tracking_mode 화이트리스트', () => {
  it('tracking_mode가 SET 절에 살아남는다 (조용히 버려지지 않음)', async () => {
    vi.mocked(queryOne).mockResolvedValue(TEMPLATE_ROW);

    await updateRoutineTemplate(7, 42, { tracking_mode: 'free' });

    const [sql, params] = lastQueryOneCall();
    expect(sql).toContain('tracking_mode = $3');
    expect(sql).toContain('WHERE id = $1 AND user_id = $2');
    expect(params).toEqual([42, 7, 'free']);
  });

  it('화이트리스트 밖 키만 오면 UPDATE 없이 null', async () => {
    const result = await updateRoutineTemplate(7, 42, { entry_type: 'free' });

    expect(result).toBeNull();
    expect(queryOne).not.toHaveBeenCalled();
  });
});

// ─── 자동 생성 차단 — 자율 루틴은 기대된 발생이 없다 ───────────────────

describe('ensureTodayRecords — 자율 루틴 자동 생성 제외 + 스탬프', () => {
  it('템플릿 조회는 주기형만, 기존·최근 기록 판정도 주기형만, INSERT는 entry_type 명시', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({
        rows: [{ id: 1, frequency: '매일', start_date: '2026-07-01' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce(empty) // 오늘 이미 존재하는 주기형 기록
      .mockResolvedValueOnce(empty) // 템플릿별 최근 기록일
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT

    const created = await ensureTodayRecords(7, '2026-07-26');

    expect(created).toBe(1);
    expect(query).toHaveBeenCalledTimes(4);

    const [templateSql] = queryCallAt(0);
    expect(templateSql).toContain('FROM routine_templates');
    expect(templateSql).toContain("tracking_mode = 'scheduled'");

    const [existingSql] = queryCallAt(1);
    expect(existingSql).toContain("entry_type = 'scheduled'");

    const [lastDateSql] = queryCallAt(2);
    expect(lastDateSql).toContain("entry_type = 'scheduled'");

    const [insertSql, insertParams] = queryCallAt(3);
    expect(insertSql).toContain('INSERT INTO routine_records');
    expect(insertSql).toContain('entry_type');
    expect(insertSql).toContain("'scheduled'");
    expect(insertParams).toEqual([7, '2026-07-26', [1]]);
  });

  it('주기형 템플릿이 0건이면 INSERT를 하지 않는다', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce(empty) // 주기형 템플릿 없음 (전부 자율)
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(empty);

    const created = await ensureTodayRecords(7, '2026-07-26');

    expect(created).toBe(0);
    expect(query).toHaveBeenCalledTimes(3);
  });
});

// ─── 통계 격리 — 자율 기록은 분자도 분모도 아니다 ──────────────────────

describe('통계 측정 격리', () => {
  it('queryRoutineStats: entry_type = scheduled 조건 포함', async () => {
    vi.mocked(query).mockResolvedValue(empty);

    await queryRoutineStats(7, '2026-07-01', '2026-07-26');

    const [sql, params] = lastQueryCall();
    expect(sql).toContain('FROM routine_records r');
    expect(sql).toContain("r.entry_type = 'scheduled'");
    expect(params).toEqual([7, '2026-07-01', '2026-07-26']);
  });

  it('queryRoutinePerStats: 기간 지정 없이도 격리 조건 유지', async () => {
    vi.mocked(query).mockResolvedValue(empty);

    await queryRoutinePerStats(7);

    const [sql, params] = lastQueryCall();
    expect(sql).toContain("r.entry_type = 'scheduled'");
    expect(params).toEqual([7]);
  });

  it('queryRoutinePerStats: 기간 지정 갈래도 격리 조건 유지', async () => {
    vi.mocked(query).mockResolvedValue(empty);

    await queryRoutinePerStats(7, '2026-07-01', '2026-07-26');

    const [sql, params] = lastQueryCall();
    expect(sql).toContain("r.entry_type = 'scheduled'");
    expect(sql).toContain('AND r.date BETWEEN $2 AND $3');
    expect(params).toEqual([7, '2026-07-01', '2026-07-26']);
  });

  it('queryRoutineHeatmap: 격리하지 않되 날짜별로 접어 중복 행을 막는다', async () => {
    vi.mocked(query).mockResolvedValue(empty);
    vi.mocked(queryOne).mockResolvedValue({ start_date: '2026-07-01' });

    await queryRoutineHeatmap(7, 1, 2026, 7);

    const [sql] = queryCallAt(0);
    expect(sql).toContain('bool_or(completed) AS completed');
    expect(sql).toContain('GROUP BY date');
    expect(sql).not.toContain('entry_type');
  });
});

// ─── 자율 기록 CRUD ────────────────────────────────────────────────────

describe('createFreeRecord — 소유·모드 검증을 한 문장에', () => {
  it('INSERT에 자율 모드 조건 + entry_type free, 파라미터 [userId, templateId, date, memo]', async () => {
    vi.mocked(queryOne).mockResolvedValue(FREE_RECORD_ROW);

    const result = await createFreeRecord(7, 1, '2026-07-26', '30분');

    expect(result).toBe(FREE_RECORD_ROW);
    const [sql, params] = lastQueryOneCall();
    expect(sql).toContain('INSERT INTO routine_records');
    expect(sql).toContain("t.tracking_mode = 'free'");
    expect(sql).toContain('t.user_id = $1');
    expect(sql).toContain('t.deleted_at IS NULL');
    expect(sql).toContain("'free'");
    expect(params).toEqual([7, 1, '2026-07-26', '30분']);
  });

  it('조건 불일치(주기형·타 유저·삭제됨)로 0행이면 null', async () => {
    vi.mocked(queryOne).mockResolvedValue(null);

    expect(await createFreeRecord(7, 1, '2026-07-26', null)).toBeNull();
  });
});

describe('deleteFreeRecord — 주기형 기록은 삭제 불가', () => {
  it("entry_type = 'free' 조건 + user_id 스코프, rowCount>0 → true", async () => {
    vi.mocked(query).mockResolvedValue(okDelete);

    const ok = await deleteFreeRecord(7, 9);

    expect(ok).toBe(true);
    const [sql, params] = lastQueryCall();
    expect(sql).toContain('DELETE FROM routine_records');
    expect(sql).toContain('WHERE id = $1 AND user_id = $2');
    expect(sql).toContain("entry_type = 'free'");
    expect(params).toEqual([9, 7]);
  });

  it('주기형 기록이라 매칭 실패(rowCount 0) → false', async () => {
    vi.mocked(query).mockResolvedValue(empty);

    expect(await deleteFreeRecord(7, 9)).toBe(false);
  });
});

describe('deleteIncompleteScheduledRecordOn — 전환 정합', () => {
  it('오늘자·미완료·주기형만 삭제 (과거·완료 기록 보존)', async () => {
    vi.mocked(query).mockResolvedValue(okDelete);

    const deleted = await deleteIncompleteScheduledRecordOn(7, 1, '2026-07-26');

    expect(deleted).toBe(1);
    const [sql, params] = lastQueryCall();
    expect(sql).toContain('DELETE FROM routine_records');
    expect(sql).toContain('date = $3');
    expect(sql).toContain("entry_type = 'scheduled'");
    expect(sql).toContain('completed = false');
    // 날짜 범위 삭제가 아니어야 한다 — 과거 기록은 그 시대의 측정
    expect(sql).not.toContain('date <');
    expect(sql).not.toContain('date >');
    expect(params).toEqual([7, 1, '2026-07-26']);
  });
});

describe('시작일 정리 — 자율 기록은 휩쓸리지 않는다', () => {
  it('deleteRecordsBefore(includeCompleted=true)도 주기형만 삭제', async () => {
    vi.mocked(query).mockResolvedValue(okDelete);

    const deleted = await deleteRecordsBefore(7, 1, '2026-07-01', true);

    expect(deleted).toBe(1);
    const [sql, params] = lastQueryCall();
    expect(sql).toContain('DELETE FROM routine_records');
    expect(sql).toContain('date < $3');
    expect(sql).toContain("entry_type = 'scheduled'");
    expect(params).toEqual([1, 7, '2026-07-01']);
  });

  it('deleteRecordsBefore(includeCompleted=false)도 격리 조건 유지', async () => {
    vi.mocked(query).mockResolvedValue(okDelete);

    await deleteRecordsBefore(7, 1, '2026-07-01', false);

    const [sql] = lastQueryCall();
    expect(sql).toContain("entry_type = 'scheduled'");
    expect(sql).toContain('completed = false');
  });

  // 안내 문구의 개수와 실제 삭제 범위가 어긋나면 사용자가 잘못된 판단으로 정리를 누른다
  it('countCompletedRecordsBefore도 같은 범위를 센다', async () => {
    vi.mocked(queryOne).mockResolvedValue({ count: 3 });

    const count = await countCompletedRecordsBefore(7, 1, '2026-07-01');

    expect(count).toBe(3);
    const [sql] = lastQueryOneCall();
    expect(sql).toContain('completed = true');
    expect(sql).toContain("entry_type = 'scheduled'");
  });
});
