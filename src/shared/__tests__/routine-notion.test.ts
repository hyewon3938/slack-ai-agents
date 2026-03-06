import { describe, it, expect, vi } from 'vitest';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';
import type { Client as NotionClient } from '@notionhq/client';
import {
  queryRoutineTemplates,
  queryTodayRoutineRecords,
  shouldCreateToday,
  frequencyBadge,
} from '../routine-notion.js';

const DB_ID = 'abcdef01-2345-6789-abcd-ef0123456789';

const makeRoutinePage = (
  overrides: {
    title?: string;
    dateStart?: string | null;
    completed?: boolean;
    timeSlot?: string;
    frequency?: string;
    active?: boolean;
    archived?: boolean;
  } = {},
): PageObjectResponse => {
  const {
    title = '테스트 루틴',
    dateStart = null,
    completed = false,
    timeSlot = '아침',
    frequency,
    active = true,
    archived = false,
  } = overrides;

  const properties: Record<string, unknown> = {
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
  };

  if (frequency) {
    properties['반복'] = {
      id: 'freq-id',
      type: 'select',
      select: { id: 'sel-f', name: frequency, color: 'default' as const },
    };
  }

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
    properties,
  } as unknown as PageObjectResponse;
};

/** search mock — 클라이언트 필터링이므로 전체 반환 */
const mockClient = (pages: PageObjectResponse[]): NotionClient => {
  return {
    search: vi.fn().mockResolvedValue({
      results: pages,
      has_more: false,
      next_cursor: null,
    }),
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

  it('반복을 올바르게 파싱한다', async () => {
    const pages = [
      makeRoutinePage({ title: '격일 루틴', frequency: '격일' }),
    ];
    const client = mockClient(pages);
    const templates = await queryRoutineTemplates(client, DB_ID);

    expect(templates[0].frequency).toBe('격일');
  });

  it('반복 미설정 시 기본값 매일을 반환한다', async () => {
    const pages = [
      makeRoutinePage({ title: '기본 루틴' }),
    ];
    const client = mockClient(pages);
    const templates = await queryRoutineTemplates(client, DB_ID);

    expect(templates[0].frequency).toBe('매일');
  });

  it('비활성 템플릿은 필터링한다', async () => {
    const pages = [
      makeRoutinePage({ title: '활성', active: true }),
      makeRoutinePage({ title: '비활성', active: false }),
    ];
    const client = mockClient(pages);
    const templates = await queryRoutineTemplates(client, DB_ID);

    expect(templates).toHaveLength(1);
    expect(templates[0].title).toBe('활성');
  });

  it('날짜가 있는 페이지(기록)는 필터링한다', async () => {
    const pages = [
      makeRoutinePage({ title: '템플릿', dateStart: null, active: true }),
      makeRoutinePage({ title: '기록', dateStart: '2026-03-06', active: true }),
    ];
    const client = mockClient(pages);
    const templates = await queryRoutineTemplates(client, DB_ID);

    expect(templates).toHaveLength(1);
    expect(templates[0].title).toBe('템플릿');
  });

  it('search에 올바른 파라미터를 전달한다', async () => {
    const client = mockClient([]);
    await queryRoutineTemplates(client, DB_ID);

    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '',
        filter: { property: 'object', value: 'page' },
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

  it('다른 날짜의 기록은 필터링한다', async () => {
    const pages = [
      makeRoutinePage({ title: '오늘', dateStart: '2026-03-06' }),
      makeRoutinePage({ title: '어제', dateStart: '2026-03-05' }),
    ];
    const client = mockClient(pages);
    const records = await queryTodayRoutineRecords(client, DB_ID, today);

    expect(records).toHaveLength(1);
    expect(records[0].title).toBe('오늘');
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

  it('반복을 올바르게 파싱한다', async () => {
    const pages = [
      makeRoutinePage({ title: '격일 루틴', dateStart: '2026-03-06', frequency: '격일' }),
    ];
    const client = mockClient(pages);
    const records = await queryTodayRoutineRecords(client, DB_ID, today);

    expect(records[0].frequency).toBe('격일');
  });

  it('날짜 없는 페이지(템플릿)는 필터링한다', async () => {
    const pages = [
      makeRoutinePage({ title: '기록', dateStart: '2026-03-06' }),
      makeRoutinePage({ title: '템플릿', dateStart: null }),
    ];
    const client = mockClient(pages);
    const records = await queryTodayRoutineRecords(client, DB_ID, today);

    expect(records).toHaveLength(1);
    expect(records[0].title).toBe('기록');
  });
});

describe('shouldCreateToday', () => {
  const today = '2026-03-06';

  it('매일: 항상 true를 반환한다', () => {
    expect(shouldCreateToday('매일', '2026-03-05', today)).toBe(true);
    expect(shouldCreateToday('매일', undefined, today)).toBe(true);
  });

  it('격일: 2일 이상 경과 시 true', () => {
    expect(shouldCreateToday('격일', '2026-03-04', today)).toBe(true);
    expect(shouldCreateToday('격일', '2026-03-03', today)).toBe(true);
  });

  it('격일: 1일 경과 시 false', () => {
    expect(shouldCreateToday('격일', '2026-03-05', today)).toBe(false);
  });

  it('3일마다: 3일 이상 경과 시 true', () => {
    expect(shouldCreateToday('3일마다', '2026-03-03', today)).toBe(true);
  });

  it('3일마다: 2일 경과 시 false', () => {
    expect(shouldCreateToday('3일마다', '2026-03-04', today)).toBe(false);
  });

  it('주1회: 7일 이상 경과 시 true', () => {
    expect(shouldCreateToday('주1회', '2026-02-27', today)).toBe(true);
  });

  it('주1회: 6일 경과 시 false', () => {
    expect(shouldCreateToday('주1회', '2026-02-28', today)).toBe(false);
  });

  it('lastDate 없으면 항상 true (첫 생성)', () => {
    expect(shouldCreateToday('격일', undefined, today)).toBe(true);
    expect(shouldCreateToday('주1회', undefined, today)).toBe(true);
  });
});

describe('frequencyBadge', () => {
  it('매일은 빈 문자열을 반환한다', () => {
    expect(frequencyBadge('매일')).toBe('');
  });

  it('격일은 (2일 마다)를 반환한다', () => {
    expect(frequencyBadge('격일')).toContain('2일 마다');
  });

  it('3일마다는 (3일 마다)를 반환한다', () => {
    expect(frequencyBadge('3일마다')).toContain('3일 마다');
  });

  it('주1회는 (1주 마다)를 반환한다', () => {
    expect(frequencyBadge('주1회')).toContain('1주 마다');
  });
});
