import { describe, it, expect, vi } from 'vitest';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';
import type { Client as NotionClient } from '@notionhq/client';
import {
  queryRoutineTemplates,
  queryTodayRoutineRecords,
} from '../routine-notion.js';

const DB_ID = 'abcdef01-2345-6789-abcd-ef0123456789';

const makeRoutinePage = (
  overrides: {
    title?: string;
    dateStart?: string | null;
    completed?: boolean;
    timeSlot?: string;
    active?: boolean;
    archived?: boolean;
  } = {},
): PageObjectResponse => {
  const {
    title = '테스트 루틴',
    dateStart = null,
    completed = false,
    timeSlot = '아침',
    active = true,
    archived = false,
  } = overrides;

  return {
    object: 'page',
    id: 'page-' + Math.random().toString(36).slice(2, 8),
    created_time: '2026-03-01T00:00:00.000Z',
    last_edited_time: '2026-03-06T00:00:00.000Z',
    archived,
    in_trash: false,
    is_locked: false,
    url: 'https://notion.so/test',
    public_url: null,
    parent: { type: 'data_source_id', data_source_id: 'ds-1', database_id: DB_ID },
    icon: null,
    cover: null,
    created_by: { object: 'user', id: 'user-1' },
    last_edited_by: { object: 'user', id: 'user-1' },
    properties: {
      Name: {
        id: 'title-id',
        type: 'title',
        title: [
          {
            type: 'text',
            text: { content: title, link: null },
            plain_text: title,
            href: null,
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: 'default',
            },
          },
        ],
      },
      Date: {
        id: 'date-id',
        type: 'date',
        date: dateStart ? { start: dateStart, end: null, time_zone: null } : null,
      },
      '완료': {
        id: 'completed-id',
        type: 'checkbox',
        checkbox: completed,
      },
      '시간대': {
        id: 'timeslot-id',
        type: 'select',
        select: { id: 'sel-1', name: timeSlot, color: 'default' as const },
      },
      '활성': {
        id: 'active-id',
        type: 'checkbox',
        checkbox: active,
      },
    },
  } as unknown as PageObjectResponse;
};

/** databases.query mock — 필터는 Notion 서버가 처리하므로 테스트에서는 전체 반환 */
const mockClient = (pages: PageObjectResponse[]): NotionClient => {
  return {
    databases: {
      query: vi.fn().mockResolvedValue({
        results: pages,
        has_more: false,
        next_cursor: null,
      }),
    },
  } as unknown as NotionClient;
};

describe('queryRoutineTemplates', () => {
  it('활성 템플릿을 반환한다', async () => {
    const pages = [
      makeRoutinePage({ title: '활성 템플릿', active: true }),
    ];
    const client = mockClient(pages);
    const templates = await queryRoutineTemplates(client, DB_ID);

    expect(templates).toHaveLength(1);
    expect(templates[0].title).toBe('활성 템플릿');
  });

  it('시간대를 올바르게 파싱한다', async () => {
    const pages = [
      makeRoutinePage({ title: '오후 루틴', timeSlot: '점심' }),
    ];
    const client = mockClient(pages);
    const templates = await queryRoutineTemplates(client, DB_ID);

    expect(templates[0].timeSlot).toBe('점심');
  });

  it('databases.query에 올바른 필터를 전달한다', async () => {
    const client = mockClient([]);
    await queryRoutineTemplates(client, DB_ID);

    expect(client.databases.query).toHaveBeenCalledWith(
      expect.objectContaining({
        database_id: DB_ID,
        filter: {
          and: [
            { property: 'Date', date: { is_empty: true } },
            { property: '활성', checkbox: { equals: true } },
          ],
        },
      }),
    );
  });
});

describe('queryTodayRoutineRecords', () => {
  const today = '2026-03-06';

  it('오늘 기록을 반환한다', async () => {
    const pages = [
      makeRoutinePage({ title: '오늘 기록', dateStart: '2026-03-06' }),
    ];
    const client = mockClient(pages);
    const records = await queryTodayRoutineRecords(client, DB_ID, today);

    expect(records).toHaveLength(1);
    expect(records[0].title).toBe('오늘 기록');
  });

  it('완료 상태를 올바르게 파싱한다', async () => {
    const pages = [
      makeRoutinePage({ title: '완료됨', dateStart: '2026-03-06', completed: true }),
      makeRoutinePage({ title: '미완료', dateStart: '2026-03-06', completed: false }),
    ];
    const client = mockClient(pages);
    const records = await queryTodayRoutineRecords(client, DB_ID, today);

    expect(records).toHaveLength(2);
    const completed = records.find((r) => r.title === '완료됨');
    const incomplete = records.find((r) => r.title === '미완료');
    expect(completed?.completed).toBe(true);
    expect(incomplete?.completed).toBe(false);
  });

  it('databases.query에 날짜 필터를 전달한다', async () => {
    const client = mockClient([]);
    await queryTodayRoutineRecords(client, DB_ID, today);

    expect(client.databases.query).toHaveBeenCalledWith(
      expect.objectContaining({
        database_id: DB_ID,
        filter: {
          property: 'Date',
          date: { equals: today },
        },
      }),
    );
  });
});
