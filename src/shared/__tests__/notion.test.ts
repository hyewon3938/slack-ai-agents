import { describe, it, expect, vi } from 'vitest';
import { queryTodaySchedules } from '../notion.js';
import type { NotionClient } from '../notion.js';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';

const DB_ID = 'abcdef01-2345-6789-abcd-ef0123456789';

const makePage = (
  overrides: {
    title?: string;
    dateStart?: string | null;
    dateEnd?: string | null;
    status?: string | null;
    category?: string[];
    icon?: PageObjectResponse['icon'];
    archived?: boolean;
  } = {},
): PageObjectResponse => {
  const {
    title = '테스트',
    dateStart = '2026-03-07',
    dateEnd = null,
    status = 'todo',
    category = [],
    icon = null,
    archived = false,
  } = overrides;

  return {
    object: 'page',
    id: 'page-' + Math.random().toString(36).slice(2, 8),
    created_time: '2026-03-01T00:00:00.000Z',
    last_edited_time: '2026-03-07T00:00:00.000Z',
    archived,
    in_trash: false,
    is_locked: false,
    url: 'https://notion.so/test',
    public_url: null,
    parent: { type: 'data_source_id', data_source_id: 'ds-1', database_id: DB_ID },
    icon,
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
        date: dateStart
          ? { start: dateStart, end: dateEnd, time_zone: null }
          : null,
      },
      상태: {
        id: 'status-id',
        type: 'select',
        select: status
          ? { id: 'sel-1', name: status, color: 'default' as const }
          : null,
      },
      카테고리: {
        id: 'cat-id',
        type: 'multi_select',
        multi_select: category.map((name, i) => ({
          id: `cat-${i}`,
          name,
          color: 'default' as const,
        })),
      },
    },
  } as unknown as PageObjectResponse;
};

/** databases.query mock */
const mockClient = (pages: PageObjectResponse[]): NotionClient => {
  return {
    dataSources: {
      query: vi.fn().mockResolvedValue({
        results: pages,
        has_more: false,
        next_cursor: null,
      }),
    },
  } as unknown as NotionClient;
};

describe('queryTodaySchedules', () => {
  const today = '2026-03-07';

  it('오늘 날짜 일정만 반환한다', async () => {
    const pages = [
      makePage({ title: '오늘 일정', dateStart: '2026-03-07' }),
      // 서버 필터 통과 후 클라이언트에서 기간 체크 — 과거 단일 일정은 제외
      makePage({ title: '어제 일정', dateStart: '2026-03-06' }),
    ];
    const client = mockClient(pages);
    const items = await queryTodaySchedules(client, DB_ID, today);

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('오늘 일정');
  });

  it('기간 일정은 오늘이 포함되면 반환한다', async () => {
    const pages = [
      makePage({
        title: '기간 일정',
        dateStart: '2026-03-05',
        dateEnd: '2026-03-10',
      }),
    ];
    const client = mockClient(pages);
    const items = await queryTodaySchedules(client, DB_ID, today);

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('기간 일정');
  });

  it('기간 일정이 이미 종료되었으면 제외한다', async () => {
    const pages = [
      makePage({
        title: '끝난 일정',
        dateStart: '2026-03-01',
        dateEnd: '2026-03-05',
      }),
    ];
    const client = mockClient(pages);
    const items = await queryTodaySchedules(client, DB_ID, today);

    expect(items).toHaveLength(0);
  });

  it('속성을 올바르게 파싱한다', async () => {
    const pages = [
      makePage({
        title: '중요 약속',
        dateStart: '2026-03-07T19:00:00+09:00',
        status: 'in-progress',
        category: ['약속'],
        icon: {
          type: 'external',
          external: {
            url: 'https://www.notion.so/icons/star_red.svg',
          },
        },
      }),
    ];
    const client = mockClient(pages);
    const items = await queryTodaySchedules(client, DB_ID, today);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: '중요 약속',
      date: { start: '2026-03-07T19:00:00+09:00', end: null },
      status: 'in-progress',
      category: ['약속'],
      hasStarIcon: true,
    });
  });

  it('databases.query에 올바른 필터를 전달한다', async () => {
    const client = mockClient([]);
    await queryTodaySchedules(client, DB_ID, today);

    expect(client.dataSources.query).toHaveBeenCalledWith(
      expect.objectContaining({
        data_source_id: DB_ID,
        filter: {
          and: [
            { property: 'Date', date: { on_or_after: expect.any(String) } },
            { property: 'Date', date: { on_or_before: today } },
          ],
        },
      }),
    );
  });
});
