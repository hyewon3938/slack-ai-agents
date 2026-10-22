import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Call {
  sql: string;
  params: unknown[];
}

const calls: Call[] = [];
let rowsBySelect: Array<Array<Record<string, unknown>>> = [];

const fakeClient = {
  query: vi.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    if (/^\s*SELECT/.test(sql)) return { rows: rowsBySelect.shift() ?? [] };
    return { rows: [] };
  }),
};

vi.mock('../../../shared/db.js', () => ({
  queryOne: vi.fn(),
  withTransaction: async (fn: (c: typeof fakeClient) => Promise<unknown>): Promise<unknown> =>
    fn(fakeClient),
}));
vi.mock('../../../shared/llm.js', () => ({ createDiaryMetaLLMClient: vi.fn() }));
vi.mock('../../../cron/diary-meta-extract.js', () => ({ extractAndPersistForUser: vi.fn() }));

const { applyDiaryEdit } = await import('../diary-edit-store.js');
const { hashDiaryContent } = await import('../diary-edit.js');

const CURRENT = { id: 7, date: '2026-10-20', content: '원래 일기' };
const base = {
  entryId: 7,
  originalDate: CURRENT.date,
  originalHash: hashDiaryContent(CURRENT.content),
  newDate: CURRENT.date,
  content: '고친 일기',
};

const writes = (): string[] =>
  calls
    .filter((c) => !/^\s*SELECT/.test(c.sql))
    .map((c) => c.sql.trim().split(/\s+/).slice(0, 3).join(' '));
const tagDelete = (): Call | undefined => calls.find((c) => c.sql.includes('diary_meta_tags'));

beforeEach(() => {
  calls.length = 0;
  rowsBySelect = [];
});

describe('applyDiaryEdit', () => {
  it('일기가 없거나 남의 일기면 not_found', async () => {
    rowsBySelect = [[]];
    expect(await applyDiaryEdit(1, base)).toEqual({ kind: 'not_found' });
    expect(calls[0]?.params).toEqual([7, 1]);
  });

  it('모달을 연 뒤 내용이나 날짜가 바뀌었으면 stale, 아무것도 쓰지 않는다', async () => {
    rowsBySelect = [[{ ...CURRENT, content: '그사이 덧붙인 일기' }]];
    expect(await applyDiaryEdit(1, base)).toEqual({ kind: 'stale' });
    rowsBySelect = [[{ ...CURRENT, date: '2026-10-19' }]];
    expect(await applyDiaryEdit(1, base)).toEqual({ kind: 'stale' });
    expect(writes()).toEqual([]);
  });

  it('같은 날짜면 내용만 바꾸고 그 날짜 태그를 지운다', async () => {
    rowsBySelect = [[CURRENT]];
    const result = await applyDiaryEdit(1, base);
    expect(result).toMatchObject({
      kind: 'saved',
      action: 'updated',
      changedDates: ['2026-10-20'],
    });
    expect(writes()).toEqual(['UPDATE diary_entries SET', 'DELETE FROM diary_meta_tags']);
    expect(tagDelete()?.params).toEqual([1, ['2026-10-20']]);
  });

  it('내용이 그대로면 unchanged, 태그도 두고 아무것도 쓰지 않는다', async () => {
    rowsBySelect = [[CURRENT]];
    const result = await applyDiaryEdit(1, { ...base, content: CURRENT.content });
    expect(result).toMatchObject({ kind: 'saved', action: 'unchanged', changedDates: [] });
    expect(writes()).toEqual([]);
  });

  it('비우면 원래 날짜 일기를 지우고 그 날짜 태그를 지운다', async () => {
    rowsBySelect = [[CURRENT]];
    const result = await applyDiaryEdit(1, { ...base, content: '' });
    expect(result).toMatchObject({ kind: 'saved', action: 'deleted', entry: null });
    expect(writes()).toEqual(['DELETE FROM diary_entries', 'DELETE FROM diary_meta_tags']);
  });

  it('빈 날짜로 옮기면 행의 날짜만 바꾸고 두 날짜 태그를 지운다', async () => {
    rowsBySelect = [[CURRENT], []];
    const result = await applyDiaryEdit(1, { ...base, newDate: '2026-10-18' });
    expect(result).toMatchObject({
      kind: 'saved',
      action: 'moved',
      entry: { id: 7, date: '2026-10-18', content: '고친 일기' },
    });
    expect(writes()).toEqual(['UPDATE diary_entries SET', 'DELETE FROM diary_meta_tags']);
    expect(tagDelete()?.params).toEqual([1, ['2026-10-20', '2026-10-18']]);
  });

  it('일기가 있는 날짜로 옮기면 뒤에 이어 붙이고 원래 행을 지운다', async () => {
    rowsBySelect = [[CURRENT], [{ id: 3, content: '그날 일기' }]];
    const result = await applyDiaryEdit(1, { ...base, newDate: '2026-10-18' });
    expect(result).toMatchObject({
      kind: 'saved',
      action: 'merged',
      entry: { id: 3, date: '2026-10-18', content: '그날 일기\n고친 일기' },
    });
    expect(writes()).toEqual([
      'UPDATE diary_entries SET',
      'DELETE FROM diary_entries',
      'DELETE FROM diary_meta_tags',
    ]);
  });

  it('모든 쿼리에 user_id를 건다', async () => {
    rowsBySelect = [[CURRENT], [{ id: 3, content: '그날 일기' }]];
    await applyDiaryEdit(42, { ...base, newDate: '2026-10-18' });
    for (const c of calls) expect(c.params).toContain(42);
  });
});
