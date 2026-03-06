import type { Client as NotionClient } from '@notionhq/client';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';
import { toUUID } from './notion.js';

export interface RoutineTemplate {
  id: string;
  title: string;
  timeSlot: string;
}

export interface RoutineRecord {
  id: string;
  title: string;
  date: string;
  completed: boolean;
  timeSlot: string;
}

const isPageObject = (
  result: { object: string },
): result is PageObjectResponse => {
  return result.object === 'page' && 'properties' in result;
};

const parseTitle = (page: PageObjectResponse): string => {
  const nameProp = page.properties['Name'];
  if (nameProp?.type === 'title') {
    return nameProp.title.map((t) => t.plain_text).join('');
  }
  return '';
};

const parseTimeSlot = (page: PageObjectResponse): string => {
  const prop = page.properties['시간대'];
  if (prop?.type === 'select' && prop.select) {
    return prop.select.name;
  }
  return '아침';
};

const parseCheckbox = (page: PageObjectResponse, name: string): boolean => {
  const prop = page.properties[name];
  if (prop?.type === 'checkbox') {
    return prop.checkbox;
  }
  return false;
};

/** 활성 템플릿 조회 (날짜 없음, 활성=true) — search + 클라이언트 필터 */
export const queryRoutineTemplates = async (
  client: NotionClient,
  dbId: string,
): Promise<RoutineTemplate[]> => {
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
    .filter((page) => {
      const dateProp = page.properties['Date'];
      const hasNoDate = dateProp?.type === 'date' && dateProp.date === null;
      const isActive = parseCheckbox(page, '활성');
      return hasNoDate && isActive;
    })
    .map((page) => ({
      id: page.id,
      title: parseTitle(page),
      timeSlot: parseTimeSlot(page),
    }));
};

/** 오늘 루틴 기록 조회 — search + 클라이언트 필터 */
export const queryTodayRoutineRecords = async (
  client: NotionClient,
  dbId: string,
  today: string,
): Promise<RoutineRecord[]> => {
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
    .filter((page) => {
      const dateProp = page.properties['Date'];
      if (dateProp?.type !== 'date' || !dateProp.date) return false;
      return dateProp.date.start.slice(0, 10) === today;
    })
    .map((page) => ({
      id: page.id,
      title: parseTitle(page),
      date: today,
      completed: parseCheckbox(page, '완료'),
      timeSlot: parseTimeSlot(page),
    }));
};

/** 루틴 기록 생성 (템플릿 → 오늘자 기록) — 생성된 레코드 반환 */
export const createRoutineRecord = async (
  client: NotionClient,
  dbId: string,
  title: string,
  timeSlot: string,
  date: string,
): Promise<RoutineRecord> => {
  const uuid = toUUID(dbId);
  const page = await client.pages.create({
    parent: { database_id: uuid },
    properties: {
      Name: { title: [{ text: { content: title } }] },
      Date: { date: { start: date } },
      '완료': { checkbox: false },
      '시간대': { select: { name: timeSlot } },
      '활성': { checkbox: false },
    },
  });
  return { id: page.id, title, date, completed: false, timeSlot };
};

/** 루틴 완료 처리 */
export const completeRoutineRecord = async (
  client: NotionClient,
  pageId: string,
): Promise<void> => {
  await client.pages.update({
    page_id: pageId,
    properties: {
      '완료': { checkbox: true },
    },
  });
};
