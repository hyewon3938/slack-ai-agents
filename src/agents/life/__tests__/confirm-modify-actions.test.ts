import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PendingModifyRow } from '../../../shared/pending-modify.js';

// modify_db 확인 카드의 실행·취소 버튼 핸들러.
// 외부 경계(DB 실행·pending 상태 전이·Slack 메시지 갱신)에 무엇이 넘어가는지 고정한다.

const mockQueryWithRowLimit = vi.fn();
const mockDryRun = vi.fn();
const mockFindActivePending = vi.fn();
const mockMarkExecuted = vi.fn();
const mockMarkCanceled = vi.fn();
const mockLoadCurrentState = vi.fn();

vi.mock('../../../shared/db.js', () => ({
  queryWithRowLimit: (...args: unknown[]): unknown => mockQueryWithRowLimit(...args),
  dryRunAffectedRows: (...args: unknown[]): unknown => mockDryRun(...args),
}));

vi.mock('../../../shared/pending-modify.js', () => ({
  findActivePending: (...args: unknown[]): unknown => mockFindActivePending(...args),
  markExecuted: (...args: unknown[]): unknown => mockMarkExecuted(...args),
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
  mockMarkExecuted.mockResolvedValue(undefined);
  mockMarkCanceled.mockResolvedValue(undefined);
  mockLoadCurrentState.mockResolvedValue({ text: '현재 상태', blocks: [STATE_BLOCK] });
});

describe('handleConfirmModifyExecute', () => {
  it('확인한 SQL을 실행하고 실행 완료로 표시, 결과 메시지에 현재 상태를 붙임', async () => {
    mockFindActivePending.mockResolvedValue(makePending());
    mockQueryWithRowLimit.mockResolvedValue({ rowCount: 3, rows: [] });

    await handleConfirmModifyExecute(makeArgs());

    expect(ack).toHaveBeenCalledTimes(1);
    expect(mockFindActivePending).toHaveBeenCalledWith('tok-1', 7);
    expect(mockQueryWithRowLimit).toHaveBeenCalledWith(SQL, 10_000, 50);
    expect(mockMarkExecuted).toHaveBeenCalledWith(99);
    expect(mockLoadCurrentState).toHaveBeenCalledWith('schedules', {
      userId: 7,
      affectedDates: ['2026-03-05'],
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
    expect(mockMarkExecuted).not.toHaveBeenCalled();
    expect(lastUpdate().text).toBe('이 요청은 만료됐거나 이미 처리됐어. 다시 요청해줘.');
    expect(lastUpdate().blocks).toEqual([]);
  });

  it('버튼 value가 비어 있으면 pending 조회도 실행도 하지 않음', async () => {
    await handleConfirmModifyExecute(makeArgs(''));

    expect(ack).toHaveBeenCalledTimes(1);
    expect(mockFindActivePending).not.toHaveBeenCalled();
    expect(mockQueryWithRowLimit).not.toHaveBeenCalled();
    expect(chatUpdate).not.toHaveBeenCalled();
  });

  it('실행이 실패하면 실행 완료로 표시하지 않고 실패 메시지로 갱신', async () => {
    mockFindActivePending.mockResolvedValue(makePending());
    mockQueryWithRowLimit.mockRejectedValue(new Error('statement timeout'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await handleConfirmModifyExecute(makeArgs());

    expect(mockMarkExecuted).not.toHaveBeenCalled();
    expect(lastUpdate().text).toBe('실행 실패: statement timeout');
    expect(lastUpdate().blocks).toEqual([]);
    errorSpy.mockRestore();
  });

  it('dry-run이 실패해도 실행은 진행하고 날짜 없이 현재 상태를 조회', async () => {
    mockFindActivePending.mockResolvedValue(makePending());
    mockDryRun.mockRejectedValue(new Error('dry-run failed'));

    await handleConfirmModifyExecute(makeArgs());

    expect(mockQueryWithRowLimit).toHaveBeenCalledWith(SQL, 10_000, 50);
    expect(mockMarkExecuted).toHaveBeenCalledWith(99);
    expect(mockLoadCurrentState).toHaveBeenCalledWith('schedules', {
      userId: 7,
      affectedDates: [],
    });
    expect(lastUpdate().text).toBe('✅ 실행 완료 — 1개 행 변경됐어.');
  });

  it('현재 상태 조회가 실패해도 실행 완료 메시지는 그대로 보냄', async () => {
    mockFindActivePending.mockResolvedValue(makePending());
    mockLoadCurrentState.mockRejectedValue(new Error('state failed'));

    await handleConfirmModifyExecute(makeArgs());

    expect(mockMarkExecuted).toHaveBeenCalledWith(99);
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
    expect(mockMarkExecuted).not.toHaveBeenCalled();
    expect(lastUpdate().text).toBe('취소했어. 아무것도 바뀌지 않았어.');
  });

  it('pending이 없어도 취소 안내로 갱신하고 상태 전이는 하지 않음', async () => {
    mockFindActivePending.mockResolvedValue(null);

    await handleConfirmModifyCancel(makeArgs());

    expect(mockMarkCanceled).not.toHaveBeenCalled();
    expect(lastUpdate().text).toBe('취소했어. 아무것도 바뀌지 않았어.');
  });
});
