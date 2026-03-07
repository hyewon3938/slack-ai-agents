import { Client as NotionClient } from '@notionhq/client';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';

export type { Client as NotionClient } from '@notionhq/client';

/**
 * Notion databases.query REST API 직접 호출.
 * SDK v5에서 databases.query가 제거되어 client.request()로 대체.
 */
export interface DatabaseQueryResponse {
  results: Array<{ object: string } & Record<string, unknown>>;
  has_more: boolean;
  next_cursor: string | null;
}

export const queryDatabase = async (
  client: NotionClient,
  databaseId: string,
  body: Record<string, unknown> = {},
): Promise<DatabaseQueryResponse> => {
  const response = await (client.request as (args: {
    path: string;
    method: string;
    body?: Record<string, unknown>;
  }) => Promise<unknown>)({
    path: `databases/${databaseId}/query`,
    method: 'post',
    body,
  });
  return response as DatabaseQueryResponse;
};

export interface ScheduleItem {
  id: string;
  title: string;
  date: { start: string; end: string | null } | null;
  status: string | null;
  category: string[];
  hasStarIcon: boolean;
}

/**
 * SDK v5는 Notion-Version 2025-09-03을 기본 사용하는데,
 * 이 버전에서 databases.query 엔드포인트가 제거됨.
 * 2022-06-28 버전을 명시하여 databases.query를 계속 사용.
 */
export const createNotionClient = (apiKey: string): NotionClient => {
  return new NotionClient({ auth: apiKey, notionVersion: '2022-06-28' });
};

const STAR_ICON_URL = 'https://www.notion.so/icons/star_red.svg';

const isPageObject = (
  result: { object: string },
): result is PageObjectResponse => {
  return result.object === 'page' && 'properties' in result;
};

const parsePageToScheduleItem = (page: PageObjectResponse): ScheduleItem => {
  const props = page.properties;

  // Title (Name)
  const nameProp = props['Name'];
  let title = '';
  if (nameProp?.type === 'title') {
    title = nameProp.title.map((t) => t.plain_text).join('');
  }

  // Date
  const dateProp = props['Date'];
  let date: ScheduleItem['date'] = null;
  if (dateProp?.type === 'date' && dateProp.date) {
    date = { start: dateProp.date.start, end: dateProp.date.end };
  }

  // 상태 (select)
  const statusProp = props['상태'];
  let status: string | null = null;
  if (statusProp?.type === 'select' && statusProp.select) {
    status = statusProp.select.name;
  }

  // 카테고리 (multi_select)
  const categoryProp = props['카테고리'];
  let category: string[] = [];
  if (categoryProp?.type === 'multi_select') {
    category = categoryProp.multi_select.map((s) => s.name);
  }

  // 중요 표시 (빨간 별 아이콘)
  const hasStarIcon =
    page.icon?.type === 'external' &&
    page.icon.external.url === STAR_ICON_URL;

  return { id: page.id, title, date, status, category, hasStarIcon };
};

/** 오늘 날짜에 해당하는 일정인지 확인 (기간 일정 포함) */
const isScheduleForDate = (
  item: ScheduleItem,
  targetDate: string,
): boolean => {
  if (!item.date) return false;

  const start = item.date.start.slice(0, 10);
  const end = item.date.end?.slice(0, 10) ?? null;

  if (end) {
    return start <= targetDate && targetDate <= end;
  }
  return start === targetDate;
};

/** 날짜를 N일 전으로 이동 (YYYY-MM-DD) */
const subtractDays = (dateStr: string, days: number): string => {
  const date = new Date(dateStr + 'T00:00:00+09:00');
  date.setDate(date.getDate() - days);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/** Notion에서 오늘 일정을 조회 — databases.query 서버 필터 */
export const queryTodaySchedules = async (
  client: NotionClient,
  dbId: string,
  today: string,
): Promise<ScheduleItem[]> => {
  const uuid = toUUID(dbId);
  const allPages: PageObjectResponse[] = [];
  let startCursor: string | undefined;

  // 기간 일정(start~end)을 잡기 위해 90일 윈도우로 서버 필터,
  // 이후 클라이언트에서 정확한 날짜 매칭
  const windowStart = subtractDays(today, 90);

  do {
    const response = await queryDatabase(client, uuid, {
      filter: {
        and: [
          { property: 'Date', date: { on_or_after: windowStart } },
          { property: 'Date', date: { on_or_before: today } },
        ],
      },
      ...(startCursor ? { start_cursor: startCursor } : {}),
    });

    const pages = (response.results as Array<{ object: string } & Record<string, unknown>>)
      .filter(isPageObject);
    allPages.push(...pages);
    startCursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (startCursor);

  return allPages
    .map(parsePageToScheduleItem)
    .filter((item) => isScheduleForDate(item, today));
};

/** 백로그 (Date가 null인 일정) 조회 */
export const queryBacklogItems = async (
  client: NotionClient,
  dbId: string,
): Promise<ScheduleItem[]> => {
  const uuid = toUUID(dbId);
  const allPages: PageObjectResponse[] = [];
  let startCursor: string | undefined;

  do {
    const response = await queryDatabase(client, uuid, {
      filter: {
        property: 'Date',
        date: { is_empty: true },
      },
      ...(startCursor ? { start_cursor: startCursor } : {}),
    });

    const pages = (response.results as Array<{ object: string } & Record<string, unknown>>)
      .filter(isPageObject);
    allPages.push(...pages);
    startCursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (startCursor);

  return allPages.map(parsePageToScheduleItem);
};

export const toUUID = (id: string): string => {
  const hex = id.replace(/-/g, '');
  if (hex.length !== 32) return id;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
