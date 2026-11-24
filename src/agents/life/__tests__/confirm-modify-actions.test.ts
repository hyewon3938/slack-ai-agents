import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PendingModifyRow } from '../../../shared/pending-modify.js';

// modify_db 확인 카드의 실행·취소 버튼 핸들러.
// 외부 경계(DB 실행·pending 상태 전이·Slack 메시지 갱신)에 무엇이 넘어가는지 고정한다.

const mockQueryWithRowLimit = vi.fn();
const mockDryRun = vi.fn();
const mockFindActivePending = vi.fn();
const mockClaim = vi.fn();
const mockRelease = vi.fn();
const mockMarkCanceled = vi.fn();
const mockLoadCurrentState = vi.fn();

vi.mock('../../../shared/db.js', () => ({
  queryWithRowLimit: (...args: unknown[]): unknown => mockQueryWithRowLimit(...args),
  dryRunAffectedRows: (...args: unknown[]): unknown => mockDryRun(...args),
}));

vi.mock('../../../shared/pending-modify.js', () => ({
  findActivePending: (...args: unknown[]): unknown => mockFindActivePending(...args),
  claimPendingExecution: (...args: unknown[]): unknown => mockClaim(...args),
  releasePendingExecution: (...args: unknown[]): unknown => mockRelease(...args),
  markCanceled: (...args: unknown[]): unknown => mockMarkCanceled(...args),
}));

vi.mock('../../../shared/pending-current-state.js', () => ({
  loadCurrentStateBlocks: (...args: unknown[]): unknown => mockLoadCurrentState(...args),
}));

vi.mock('../../../shared/user-resolver.js', () => ({
  DEFAULT_USER_ID: 1,
  resolveUserId: vi.fn(() => Promise.resolve(7)),
}));

const { handleConfirmModifyExecute, handleConfirmModifyCancel } =
  await import('../confirm-modify-actions.js');

const SQL = "UPDATE schedules SET status = 'done' WHERE id = 10";

const makePending = (overrides: Partial<PendingModifyRow> = {}): PendingModifyRow => ({
  id: 99,
  token: 'tok-1',
  user_id: 7,
  sql_text: SQL,
  dry_run_row_count: 1,
  table_name: 'schedules',
  slack_channel: 'C1',
  slack_thread_ts: null,
  created_at: '2026-03-08 10:00:00',
  expires_at: '2026-03-08 10:10:00',
  executed_at: null,
  canceled_at: null,
  ...overrides,
});

const STATE_BLOCK = { type: 'section', text: { type: 'mrkdwn', text: '현재 상태' } };

let chatUpdate: ReturnType<typeof vi.fn>;
let ack: ReturnType<typeof vi.fn>;

const makeArgs = (value = 'tok-1'): never =>
  ({
    ack,
    body: {
      user: { id: 'U_SLACK' },
      actions: [{ value }],
      channel: { id: 'C1' },
      message: { ts: '111.222' },
    },
    client: { chat: { update: chatUpdate } },
  }) as never;

/** chat.update 마지막 호출 인자 */
const lastUpdate = (): { channel: string; ts: string; text: string; blocks: unknown[] } =>
  chatUpdate.mock.calls.at(-1)?.[0] as {
    channel: string;
    ts: string;
    text: string;
    blocks: unknown[];
  };

beforeEach(() => {
  vi.clearAllMocks();
  chatUpdate = vi.fn().mockResolvedValue({ ok: true });
  ack = vi.fn().mockResolvedValue(undefined);
  mockDryRun.mockResolvedValue({ rowCount: 1, rows: [{ id: 10, date: '2026-03-05' }] });
  mockQueryWithRowLimit.mockResolvedValue({ rowCount: 1, rows: [] });
  mockClaim.mockResolvedValue(true);
  mockRelease.mockResolvedValue(undefined);
  mockMarkCanceled.mockResolvedValue(undefined);
  mockLoadCurrentState.mockResolvedValue({ text: '현재 상태', blocks: [STATE_BLOCK] });
});

describe('handleConfirmModifyExecute', () => {
  it('실행 전에 pending을 선점하고 SQL을 실행, 결과 메시지에 현재 상태를 붙임', async () => {
    mockFindActivePending.mockResolvedValue(makePending());
    mockQueryWithRowLimit.mockResolvedValue({ rowCount: 3, rows: [] });

    await handleConfirmModifyExecute(makeArgs());

    expect(ack).toHaveBeenCalledTimes(1);
    expect(mockFindActivePending).toHaveBeenCalledWith('tok-1', 7);
    expect(mockClaim).toHaveBeenCalledWith(99);
    expect(mockClaim.mock.invocationCallOrder[0]).toBeLessThan(
      mockQueryWithRowLimit.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mockQueryWithRowLimit).toHaveBeenCalledWith(SQL, 10_000, 50);
    expect(mockRelease).not.toHaveBeenCalled();
    expect(mockLoadCurrentState).toHaveBeenCalledWith('schedules', {
      userId: 7,
      affectedDates: ['2026-03-05'],
      hasBacklog: false,
    });
    const update = lastUpdate();
    expect(update.channel).toBe('C1');
    expect(update.ts).toBe('111.222');
    expect(update.text).toBe('✅ 실행 완료 — 3개 행 변경됐어.');
    expect(update.blocks).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: update.text } },
      { type: 'divider' },
      STATE_BLOCK,
    ]);
  });

  it('pending이 없으면(만료·처리됨) SQL을 실행하지 않고 만료 안내로 갱신', async () => {
    mockFindActivePending.mockResolvedValue(null);

    await handleConfirmModifyExecute(makeArgs());

    expect(mockDryRun).not.toHaveBeenCalled();
    expect(mockQueryWithRowLimit).not.toHaveBeenCalled();
    expect(mockClaim).not.toHaveBeenCalled();
    expect(lastUpdate().text).toBe('이 요청은 만료됐거나 이미 처리됐어. 다시 요청해줘.');
    expect(lastUpdate().blocks).toEqual([]);
  });

  it('선점에 실패하면(동시 클릭 등 이미 처리 중) SQL을 실행하지 않고 만료 안내로 갱신', async () => {
    mockFindActivePending.mockResolvedValue(makePending());
    mockClaim.mockResolvedValue(false);

    await handleConfirmModifyExecute(makeArgs());

    expect(mockClaim).toHaveBeenCalledWith(99);
    expect(mockDryRun).not.toHaveBeenCalled();
    expect(mockQueryWithRowLimit).not.toHaveBeenCalled();
    expect(lastUpdate().text).toBe('이 요청은 만료됐거나 이미 처리됐어. 다시 요청해줘.');
  });

  it('버튼 value가 비어 있으면 pending 조회도 실행도 하지 않음', async () => {
    await handleConfirmModifyExecute(makeArgs(''));

    expect(ack).toHaveBeenCalledTimes(1);
    expect(mockFindActivePending).not.toHaveBeenCalled();
    expect(mockQueryWithRowLimit).not.toHaveBeenCalled();
    expect(chatUpdate).not.toHaveBeenCalled();
  });

  it('SQL 실행이 실패하면 선점을 풀고 실패 메시지로 갱신', async () => {
    mockFindActivePending.mockResolvedValue(makePending());
    mockQueryWithRowLimit.mockRejectedValue(new Error('statement timeout'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await handleConfirmModifyExecute(makeArgs());

    expect(mockRelease).toHaveBeenCalledWith(99);
    expect(lastUpdate().text).toBe('실행 실패: statement timeout');
    expect(lastUpdate().blocks).toEqual([]);
    errorSpy.mockRestore();
  });

  it('선점 해제까지 실패해도 원래 실행 오류를 실패 메시지로 보여줌', async () => {
    mockFindActivePending.mockResolvedValue(makePending());
    mockQueryWithRowLimit.mockRejectedValue(new Error('statement timeout'));
    mockRelease.mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await handleConfirmModifyExecute(makeArgs());

    expect(lastUpdate().text).toBe('실행 실패: statement timeout');
    errorSpy.mockRestore();
  });

  it('SQL 실행 뒤 메시지 갱신이 실패해도 실행 실패로 덮어쓰지 않고 선점도 풀지 않음', async () => {
    mockFindActivePending.mockResolvedValue(makePending());
    chatUpdate.mockRejectedValue(new Error('slack down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await handleConfirmModifyExecute(makeArgs());

    expect(mockQueryWithRowLimit).toHaveBeenCalledTimes(1);
    expect(mockRelease).not.toHaveBeenCalled();
    expect(chatUpdate).toHaveBeenCalledTimes(1);
    expect(lastUpdate().text).toBe('✅ 실행 완료 — 1개 행 변경됐어.');
    errorSpy.mockRestore();
  });

  it('dry-run이 실패해도 실행은 진행하고 날짜 없이 현재 상태를 조회', async () => {
    mockFindActivePending.mockResolvedValue(makePending());
    mockDryRun.mockRejectedValue(new Error('dry-run failed'));

    await handleConfirmModifyExecute(makeArgs());

    expect(mockQueryWithRowLimit).toHaveBeenCalledWith(SQL, 10_000, 50);
    expect(mockLoadCurrentState).toHaveBeenCalledWith('schedules', {
      userId: 7,
      affectedDates: [],
      hasBacklog: false,
    });
    expect(lastUpdate().text).toBe('✅ 실행 완료 — 1개 행 변경됐어.');
  });

  it('영향받은 일정에 날짜 없는 백로그가 있으면 백로그 기준으로 현재 상태를 조회', async () => {
    mockFindActivePending.mockResolvedValue(makePending());
    mockDryRun.mockResolvedValue({ rowCount: 1, rows: [{ id: 10, date: null }] });

    await handleConfirmModifyExecute(makeArgs());

    expect(mockLoadCurrentState).toHaveBeenCalledWith('schedules', {
      userId: 7,
      affectedDates: [],
      hasBacklog: true,
    });
  });

  it('현재 상태 조회가 실패해도 실행 완료 메시지는 그대로 보냄', async () => {
    mockFindActivePending.mockResolvedValue(makePending());
    mockLoadCurrentState.mockRejectedValue(new Error('state failed'));

    await handleConfirmModifyExecute(makeArgs());

    expect(lastUpdate().text).toBe('✅ 실행 완료 — 1개 행 변경됐어.');
    expect(lastUpdate().blocks).toHaveLength(1);
  });

  it('table_name이 없으면 현재 상태를 조회하지 않음', async () => {
    mockFindActivePending.mockResolvedValue(makePending({ table_name: null }));

    await handleConfirmModifyExecute(makeArgs());

    expect(mockLoadCurrentState).not.toHaveBeenCalled();
    expect(lastUpdate().blocks).toHaveLength(1);
  });
});

describe('handleConfirmModifyCancel', () => {
  it('pending을 취소로 표시하고 SQL은 실행하지 않음', async () => {
    mockFindActivePending.mockResolvedValue(makePending());

    await handleConfirmModifyCancel(makeArgs());

    expect(mockFindActivePending).toHaveBeenCalledWith('tok-1', 7);
    expect(mockMarkCanceled).toHaveBeenCalledWith(99);
    expect(mockQueryWithRowLimit).not.toHaveBeenCalled();
    expect(mockClaim).not.toHaveBeenCalled();
    expect(lastUpdate().text).toBe('취소했어. 아무것도 바뀌지 않았어.');
  });

  it('pending이 없어도 취소 안내로 갱신하고 상태 전이는 하지 않음', async () => {
    mockFindActivePending.mockResolvedValue(null);

    await handleConfirmModifyCancel(makeArgs());

    expect(mockMarkCanceled).not.toHaveBeenCalled();
    expect(lastUpdate().text).toBe('취소했어. 아무것도 바뀌지 않았어.');
  });
});
