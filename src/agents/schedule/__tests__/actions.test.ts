import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App } from '@slack/bolt';
import type { Client as NotionClient } from '@notionhq/client';
import { POSTPONE_ACTION, encodeOverflowValue } from '../blocks.js';
import { registerScheduleActions } from '../actions.js';

vi.mock('../../../shared/notion.js', () => ({
  updatePageProperties: vi.fn(),
  queryTodaySchedules: vi.fn(async () => []),
  getCategoryOrder: vi.fn(async () => ['약속']),
}));

vi.mock('../../../shared/slack.js', () => ({
  updateMessage: vi.fn(),
}));

const { updatePageProperties, queryTodaySchedules } = await import(
  '../../../shared/notion.js'
);
const { updateMessage } = await import('../../../shared/slack.js');

const mockedUpdatePage = vi.mocked(updatePageProperties);
const mockedQuerySchedules = vi.mocked(queryTodaySchedules);
const mockedUpdateMessage = vi.mocked(updateMessage);

describe('registerScheduleActions', () => {
  let capturedHandler: (args: Record<string, unknown>) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();

    // app.action() 호출 시 콜백 캡처
    const mockApp = {
      action: vi.fn((_actionId: string, handler: (args: Record<string, unknown>) => Promise<void>) => {
        capturedHandler = handler;
      }),
    } as unknown as App;

    const mockNotionClient = {} as NotionClient;
    registerScheduleActions(mockApp, mockNotionClient, 'db-123');
  });

  const createActionBody = (value: string) => ({
    ack: vi.fn(),
    body: {
      actions: [{ selected_option: { value } }],
      channel: { id: 'C123' },
      message: { ts: '1234567890.123456' },
    },
    client: { chat: { update: vi.fn() } },
  });

  it('일반 상태 변경 시 상태만 업데이트한다', async () => {
    const value = encodeOverflowValue('page-1', 'done', '2026-03-07');
    const args = createActionBody(value);
    mockedQuerySchedules.mockResolvedValueOnce([]);

    await capturedHandler(args);

    expect(args.ack).toHaveBeenCalled();
    expect(mockedUpdatePage).toHaveBeenCalledWith(
      expect.anything(),
      'page-1',
      { '상태': { select: { name: 'done' } } },
    );
  });

  it('postpone 시 Date를 내일로 변경하고 상태를 todo로 리셋한다', async () => {
    const value = encodeOverflowValue('page-2', POSTPONE_ACTION, '2026-03-07');
    const args = createActionBody(value);
    mockedQuerySchedules.mockResolvedValueOnce([]);

    await capturedHandler(args);

    expect(args.ack).toHaveBeenCalled();
    expect(mockedUpdatePage).toHaveBeenCalledWith(
      expect.anything(),
      'page-2',
      {
        'Date': { date: { start: '2026-03-08' } },
        '상태': { select: { name: 'todo' } },
      },
    );
  });

  it('상태 변경 후 일정을 재조회하고 메시지를 업데이트한다', async () => {
    const value = encodeOverflowValue('page-1', 'done', '2026-03-07');
    const args = createActionBody(value);
    mockedQuerySchedules.mockResolvedValueOnce([]);

    await capturedHandler(args);

    expect(mockedQuerySchedules).toHaveBeenCalledWith(
      expect.anything(),
      'db-123',
      '2026-03-07',
    );
    expect(mockedUpdateMessage).toHaveBeenCalled();
  });

  it('오류 발생 시 콘솔에 로그를 남긴다', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const value = encodeOverflowValue('page-1', 'done', '2026-03-07');
    const args = createActionBody(value);
    mockedUpdatePage.mockRejectedValueOnce(new Error('API 오류'));

    await capturedHandler(args);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('상태 변경 오류'),
    );
    consoleSpy.mockRestore();
  });
});
