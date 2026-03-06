import { Client as NotionClient } from '@notionhq/client';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';

export type { Client as NotionClient } from '@notionhq/client';

export interface ScheduleItem {
  id: string;
  title: string;
  date: { start: string; end: string | null } | null;
  status: string | null;
  category: string[];
  hasStarIcon: boolean;
}

export const createNotionClient = (apiKey: string): NotionClient => {
  return new NotionClient({ auth: apiKey });
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

/** Notion에서 오늘 일정을 조회 (페이지네이션 포함) */
export const queryTodaySchedules = async (
  client: NotionClient,
  dbId: string,
  today: string,
): Promise<ScheduleItem[]> => {
  const uuid = toUUID(dbId);
  const allPages: PageObjectResponse[] = [];
  let startCursor: string | undefined;

  do {
    const response = await client.search({
      query: '',
      filter: { property: 'object', value: 'page' },
      page_size: 100,
      ...(startCursor ? { start_cursor: startCursor } : {}),
    });

    const pages = response.results.filter(
      (result): result is PageObjectResponse => {
        if (!isPageObject(result)) return false;
        if (result.archived || result.in_trash) return false;
        const databaseId =
          'database_id' in result.parent ? result.parent.database_id : undefined;
        return databaseId === uuid;
      },
    );

    allPages.push(...pages);
    startCursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (startCursor);

  return allPages
    .map(parsePageToScheduleItem)
    .filter((item) => isScheduleForDate(item, today));
};

export const toUUID = (id: string): string => {
  const hex = id.replace(/-/g, '');
  if (hex.length !== 32) return id;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
