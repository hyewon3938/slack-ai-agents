import type { Client as NotionClient } from '@notionhq/client';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';
import { toUUID } from './notion.js';

export const FREQUENCY_OPTIONS = ['매일', '격일', '3일마다', '주1회'] as const;
export type Frequency = (typeof FREQUENCY_OPTIONS)[number];

export interface RoutineTemplate {
  id: string;
  title: string;
  timeSlot: string;
  frequency: Frequency;
}

export interface RoutineRecord {
  id: string;
  title: string;
  date: string;
  completed: boolean;
  timeSlot: string;
  frequency: Frequency;
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

export const parseFrequency = (page: PageObjectResponse): Frequency => {
  const prop = page.properties['반복'];
  if (prop?.type === 'select' && prop.select) {
    const name = prop.select.name;
    if ((FREQUENCY_OPTIONS as readonly string[]).includes(name)) {
      return name as Frequency;
    }
  }
  return '매일';
};

/** 두 날짜 사이의 일수 계산 (YYYY-MM-DD) */
const daysBetween = (from: string, to: string): number => {
  const msPerDay = 86_400_000;
  const fromDate = new Date(from + 'T00:00:00+09:00');
  const toDate = new Date(to + 'T00:00:00+09:00');
  return Math.round((toDate.getTime() - fromDate.getTime()) / msPerDay);
};

/** 빈도에 따라 오늘 기록을 생성해야 하는지 판별 */
export const shouldCreateToday = (
  frequency: Frequency,
  lastDate: string | undefined,
  today: string,
): boolean => {
  if (frequency === '매일') return true;
  if (!lastDate) return true;

  const gap = daysBetween(lastDate, today);

  switch (frequency) {
    case '격일':
      return gap >= 2;
    case '3일마다':
      return gap >= 3;
    case '주1회':
      return gap >= 7;
    default:
      return true;
  }
};

/** 빈도 → 표시용 배지 텍스트 (매일은 빈 문자열) */
export const frequencyBadge = (frequency: Frequency): string => {
  switch (frequency) {
    case '격일':
      return '_(2일 마다)_';
    case '3일마다':
      return '_(3일 마다)_';
    case '주1회':
      return '_(1주 마다)_';
    default:
      return '';
  }
};

/** DB 내 특정 템플릿의 가장 최근 기록 날짜 조회 */
export const queryLastRecordDate = async (
  client: NotionClient,
  dbId: string,
  title: string,
  timeSlot: string,
): Promise<string | undefined> => {
  const uuid = toUUID(dbId);
  const allPages: PageObjectResponse[] = [];
  let startCursor: string | undefined;

  do {
    const response = await client.search({
      query: title,
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

  const dates = allPages
    .filter((page) => {
      const dateProp = page.properties['Date'];
      if (dateProp?.type !== 'date' || !dateProp.date) return false;
      if (parseTitle(page) !== title) return false;
      if (parseTimeSlot(page) !== timeSlot) return false;
      return true;
    })
    .map((page) => {
      const dateProp = page.properties['Date'];
      if (dateProp?.type === 'date' && dateProp.date) {
        return dateProp.date.start.slice(0, 10);
      }
      return '';
    })
    .filter(Boolean)
    .sort()
    .reverse();

  return dates[0];
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
      frequency: parseFrequency(page),
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
      frequency: parseFrequency(page),
    }));
};

/** 루틴 기록 생성 (템플릿 → 오늘자 기록) — 생성된 레코드 반환 */
export const createRoutineRecord = async (
  client: NotionClient,
  dbId: string,
  title: string,
  timeSlot: string,
  date: string,
  frequency: Frequency = '매일',
): Promise<RoutineRecord> => {
  const uuid = toUUID(dbId);
  const page = await client.pages.create({
    parent: { database_id: uuid },
    properties: {
      Name: { title: [{ text: { content: title } }] },
      Date: { date: { start: date } },
      '완료': { checkbox: false },
      '시간대': { select: { name: timeSlot } },
      '반복': { select: { name: frequency } },
      '활성': { checkbox: false },
    },
  });
  return { id: page.id, title, date, completed: false, timeSlot, frequency };
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
