import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import type { QueryResult } from '@/lib/db';
import {
  updateSchedule,
  deleteSchedule,
  recordDeleteReason,
  createCategory,
  updateCategory,
  reorderCategories,
} from '../queries';

// ─── 합성 픽스처 (실제 개인 데이터 아님) ───────────────────────────────
// @/lib/db의 query/queryOne을 스텁하고 동적으로 조립되는 SET 절·파라미터 순서와
// user_id 스코프를 검증한다. 동적 SQL은 자리표시자 번호와 값 배열이 한 칸만 어긋나도
// 다른 컬럼에 값이 들어가므로 이 둘을 함께 고정한다.

const empty: QueryResult = { rows: [], rowCount: 0 };

function lastQueryCall(): [string, unknown[]] {
  const call = vi.mocked(query).mock.calls.at(-1);
  if (!call) throw new Error('query 미호출');
  return [call[0], (call[1] ?? []) as unknown[]];
}

function lastQueryOneCall(): [string, unknown[]] {
  const call = vi.mocked(queryOne).mock.calls.at(-1);
  if (!call) throw new Error('queryOne 미호출');
  return [call[0], (call[1] ?? []) as unknown[]];
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('updateSchedule — 동적 SET 절', () => {
  it('SET 자리표시자는 $2부터, 일정 id는 마지막 자리, WHERE는 user_id 스코프', async () => {
    vi.mocked(query).mockResolvedValue(empty);

    await updateSchedule(7, 42, { title: '회의', status: 'done' });

    const [sql, params] = lastQueryCall();
    expect(sql).toContain('UPDATE schedules SET title = $2, status = $3');
    expect(sql).toContain('WHERE user_id = $1 AND id = $4');
    expect(params).toEqual([7, '회의', 'done', 42]);
  });

  it('화이트리스트 밖 키(user_id·id)는 SET 절에 넣지 않는다', async () => {
    vi.mocked(query).mockResolvedValue(empty);

    await updateSchedule(7, 42, { title: '회의', user_id: 99, id: 1 } as never);

    const [sql, params] = lastQueryCall();
    expect(sql).not.toContain('user_id = $2');
    expect(sql).not.toMatch(/SET[^W]*\bid =/);
    expect(params).toEqual([7, '회의', 42]);
  });

  it('undefined 값은 건너뛰고 null·false는 그대로 반영한다', async () => {
    vi.mocked(query).mockResolvedValue(empty);

    await updateSchedule(7, 42, { title: undefined, date: null, important: false });

    const [sql, params] = lastQueryCall();
    expect(sql).toContain('SET date = $2, important = $3');
    expect(sql).not.toContain('title =');
    expect(params).toEqual([7, null, false, 42]);
  });

  it('반영할 필드가 없으면 UPDATE 없이 현재 행을 user 스코프로 조회한다', async () => {
    vi.mocked(queryOne).mockResolvedValue(null);

    await updateSchedule(7, 42, { title: undefined, user_id: 99 } as never);

    expect(query).not.toHaveBeenCalled();
    const [sql, params] = lastQueryOneCall();
    expect(sql).toContain('WHERE s.user_id = $1 AND s.id = $2');
    expect(params).toEqual([7, 42]);
  });

  it('갱신된 행이 없으면(타 유저·없는 id) null', async () => {
    vi.mocked(query).mockResolvedValue(empty);

    expect(await updateSchedule(7, 42, { title: '회의' })).toBeNull();
  });
});

describe('deleteSchedule', () => {
  it('user_id 스코프로 삭제하고 rowCount > 0이면 true', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1 });

    expect(await deleteSchedule(7, 42)).toBe(true);
    const [sql, params] = lastQueryCall();
    expect(sql).toContain('WHERE user_id = $1 AND id = $2');
    expect(params).toEqual([7, 42]);
  });

  it('rowCount가 0이거나 null이면 false', async () => {
    vi.mocked(query).mockResolvedValueOnce(empty);
    expect(await deleteSchedule(7, 42)).toBe(false);

    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: null } as unknown as QueryResult);
    expect(await deleteSchedule(7, 42)).toBe(false);
  });
});

describe('recordDeleteReason — 최신 tombstone에 한 번만', () => {
  it('사유가 비어 있는 최신 삭제 기록만 갱신하고 파라미터는 [user, schedule, category, text]', async () => {
    vi.mocked(query).mockResolvedValue(empty);

    await recordDeleteReason(7, 42, 'changed_mind', null);

    const [sql, params] = lastQueryCall();
    expect(sql).toContain('UPDATE schedule_changes');
    expect(sql).toContain("change_type = 'deleted'");
    expect(sql).toContain('delete_reason_category IS NULL');
    expect(sql).toContain('SELECT MAX(id) FROM schedule_changes');
    expect(sql).toContain('user_id = $1 AND schedule_id = $2');
    expect(params).toEqual([7, 42, 'changed_mind', null]);
  });
});

describe('createCategory — sort_order 산정', () => {
  it('최상위 카테고리는 parent_id IS NULL 범위의 max + 1', async () => {
    vi.mocked(queryOne).mockResolvedValue({ max: 4 });
    vi.mocked(query).mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    await createCategory(7, { name: '운동' });

    const [maxSql, maxParams] = lastQueryOneCall();
    expect(maxSql).toContain('parent_id IS NULL');
    expect(maxParams).toEqual([7]);

    const [, insertParams] = lastQueryCall();
    // 색·타입 미지정 시 gray·task 기본값
    expect(insertParams).toEqual([7, '운동', 'gray', 'task', 5, null]);
  });

  it('하위 카테고리는 같은 부모 범위의 max + 1, parent_id를 그대로 저장', async () => {
    vi.mocked(queryOne).mockResolvedValue({ max: 2 });
    vi.mocked(query).mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    await createCategory(7, { name: '러닝', color: 'violet', type: 'event', parent_id: 3 });

    const [maxSql, maxParams] = lastQueryOneCall();
    expect(maxSql).toContain('parent_id = $2');
    expect(maxParams).toEqual([7, 3]);

    const [, insertParams] = lastQueryCall();
    expect(insertParams).toEqual([7, '러닝', 'violet', 'event', 3, 3]);
  });

  it('max 조회 결과가 없으면 sort_order 1로 시작', async () => {
    vi.mocked(queryOne).mockResolvedValue(null);
    vi.mocked(query).mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    await createCategory(7, { name: '운동' });

    const [, insertParams] = lastQueryCall();
    expect(insertParams[4]).toBe(1);
  });

  it('INSERT가 행을 돌려주지 않으면 throw', async () => {
    vi.mocked(queryOne).mockResolvedValue({ max: 0 });
    vi.mocked(query).mockResolvedValue(empty);

    await expect(createCategory(7, { name: '운동' })).rejects.toThrow();
  });
});

describe('updateCategory — 동적 SET 절', () => {
  it('화이트리스트 키만 $2부터 반영하고 id는 마지막 자리', async () => {
    vi.mocked(query).mockResolvedValue(empty);

    await updateCategory(7, 3, { name: '운동', sort_order: 2, parent_id: 9 } as never);

    const [sql, params] = lastQueryCall();
    expect(sql).toContain('UPDATE categories SET name = $2, sort_order = $3');
    expect(sql).not.toContain('parent_id = $');
    expect(sql).toContain('WHERE user_id = $1 AND id = $4');
    expect(params).toEqual([7, '운동', 2, 3]);
  });

  it('반영할 필드가 없으면 쿼리 없이 null', async () => {
    const result = await updateCategory(7, 3, { name: undefined, user_id: 9 } as never);

    expect(result).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('reorderCategories', () => {
  it('빈 배열이면 쿼리하지 않는다', async () => {
    await reorderCategories(7, []);

    expect(query).not.toHaveBeenCalled();
  });

  it('id·sort_order를 같은 순서의 배열 두 개로 넘기고 user_id로 범위를 좁힌다', async () => {
    vi.mocked(query).mockResolvedValue(empty);

    await reorderCategories(7, [
      { id: 3, sort_order: 1 },
      { id: 1, sort_order: 2 },
    ]);

    const [sql, params] = lastQueryCall();
    expect(sql).toContain('UNNEST($1::int[], $2::int[])');
    expect(sql).toContain('c.user_id = $3');
    expect(params).toEqual([[3, 1], [1, 2], 7]);
  });
});
