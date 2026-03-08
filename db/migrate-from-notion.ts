/**
 * Notion → PostgreSQL 1회성 마이그레이션 스크립트.
 * 사용: npx tsx db/migrate-from-notion.ts [--dry-run]
 *
 * 필요 환경변수:
 *   NOTION_API_KEY, NOTION_ROUTINE_DB_ID, NOTION_SCHEDULE_DB_ID,
 *   NOTION_SLEEP_DB_ID (선택), DATABASE_URL
 */
import 'dotenv/config';
import { Client as NotionClient } from '@notionhq/client';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';
import { connectDB, disconnectDB } from '../src/shared/db.js';
import { query } from '../src/shared/db.js';

// ─── Notion SDK 헬퍼 ─────────────────────────────────────

const NOTION_API_VERSION = '2022-06-28';

const toUUID = (id: string): string => {
  const hex = id.replace(/-/g, '');
  if (hex.length !== 32) return id;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

interface DatabaseQueryResponse {
  results: Array<{ object: string } & Record<string, unknown>>;
  has_more: boolean;
  next_cursor: string | null;
}

const queryDatabase = async (
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

const isPageObject = (
  result: { object: string },
): result is PageObjectResponse =>
  result.object === 'page' && 'properties' in result;

/** Notion DB에서 전체 페이지를 페이지네이션으로 조회 */
const queryAllPages = async (
  client: NotionClient,
  dbId: string,
  filter?: Record<string, unknown>,
): Promise<PageObjectResponse[]> => {
  const uuid = toUUID(dbId);
  const allPages: PageObjectResponse[] = [];
  let startCursor: string | undefined;

  do {
    const response = await queryDatabase(client, uuid, {
      ...(filter ? { filter } : {}),
      ...(startCursor ? { start_cursor: startCursor } : {}),
    });

    const pages = response.results.filter(isPageObject);
    allPages.push(...pages);
    startCursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (startCursor);

  return allPages;
};

// ─── Notion 속성 파싱 ─────────────────────────────────────

const parseTitle = (page: PageObjectResponse): string => {
  const prop = page.properties['Name'];
  if (prop?.type === 'title') return prop.title.map((t) => t.plain_text).join('');
  return '';
};

const parseSelect = (page: PageObjectResponse, name: string): string | null => {
  const prop = page.properties[name];
  if (prop?.type === 'select' && prop.select) return prop.select.name;
  return null;
};

const parseCheckbox = (page: PageObjectResponse, name: string): boolean => {
  const prop = page.properties[name];
  if (prop?.type === 'checkbox') return prop.checkbox;
  return false;
};

const parseDate = (page: PageObjectResponse): { start: string; end: string | null } | null => {
  const prop = page.properties['Date'];
  if (prop?.type === 'date' && prop.date) {
    return { start: prop.date.start, end: prop.date.end };
  }
  return null;
};

const parseMultiSelect = (page: PageObjectResponse, name: string): string[] => {
  const prop = page.properties[name];
  if (prop?.type === 'multi_select') return prop.multi_select.map((s) => s.name);
  return [];
};

const parseRichText = (page: PageObjectResponse, name: string): string => {
  const prop = page.properties[name];
  if (prop?.type === 'rich_text') return prop.rich_text.map((t) => t.plain_text).join('');
  return '';
};

const parseNumber = (page: PageObjectResponse, name: string): number => {
  const prop = page.properties[name];
  if (prop?.type === 'number' && prop.number !== null) return prop.number;
  return 0;
};

// ─── 마이그레이션 함수 ────────────────────────────────────

const migrateRoutines = async (client: NotionClient, dbId: string, dryRun: boolean): Promise<void> => {
  console.log('\n── 루틴 마이그레이션 ──');

  // 1. 템플릿 조회 (Date=null, 활성=true)
  const templatePages = await queryAllPages(client, dbId, {
    and: [
      { property: 'Date', date: { is_empty: true } },
      { property: '활성', checkbox: { equals: true } },
    ],
  });
  console.log(`템플릿: ${templatePages.length}개 발견`);

  // 2. 레코드 조회 (Date=날짜)
  const recordPages = await queryAllPages(client, dbId, {
    property: 'Date',
    date: { is_not_empty: true },
  });
  console.log(`기록: ${recordPages.length}개 발견`);

  if (dryRun) return;

  // 3. 템플릿 INSERT
  const templateIdMap = new Map<string, number>(); // "name|time_slot" → SQL id

  for (const page of templatePages) {
    const name = parseTitle(page);
    const timeSlot = parseSelect(page, '시간대') ?? '아침';
    const frequency = parseSelect(page, '반복') ?? '매일';

    const result = await query<{ id: number }>(
      `INSERT INTO routine_templates (name, time_slot, frequency, active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [name, timeSlot, frequency],
    );

    if (result.rows[0]) {
      templateIdMap.set(`${name}|${timeSlot}`, result.rows[0].id);
    } else {
      // 이미 존재하면 기존 id 조회
      const existing = await query<{ id: number }>(
        'SELECT id FROM routine_templates WHERE name = $1 AND time_slot = $2',
        [name, timeSlot],
      );
      if (existing.rows[0]) {
        templateIdMap.set(`${name}|${timeSlot}`, existing.rows[0].id);
      }
    }
  }
  console.log(`템플릿 INSERT 완료: ${templateIdMap.size}개`);

  // 4. 레코드 INSERT
  let recordCount = 0;
  for (const page of recordPages) {
    const name = parseTitle(page);
    const timeSlot = parseSelect(page, '시간대') ?? '아침';
    const date = parseDate(page);
    const completed = parseCheckbox(page, '완료');

    if (!date) continue;
    const dateStr = date.start.slice(0, 10);

    const key = `${name}|${timeSlot}`;
    let templateId = templateIdMap.get(key);

    // 템플릿이 없으면 비활성 템플릿으로 생성
    if (!templateId) {
      const frequency = parseSelect(page, '반복') ?? '매일';
      const result = await query<{ id: number }>(
        `INSERT INTO routine_templates (name, time_slot, frequency, active)
         VALUES ($1, $2, $3, false)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [name, timeSlot, frequency],
      );
      if (result.rows[0]) {
        templateId = result.rows[0].id;
        templateIdMap.set(key, templateId);
      } else {
        const existing = await query<{ id: number }>(
          'SELECT id FROM routine_templates WHERE name = $1 AND time_slot = $2',
          [name, timeSlot],
        );
        templateId = existing.rows[0]?.id;
      }
    }

    if (!templateId) {
      console.warn(`  [SKIP] 템플릿 매칭 실패: ${name} (${timeSlot})`);
      continue;
    }

    await query(
      `INSERT INTO routine_records (template_id, date, completed)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [templateId, dateStr, completed],
    );
    recordCount++;
  }
  console.log(`기록 INSERT 완료: ${recordCount}개`);
};

const migrateSchedules = async (client: NotionClient, dbId: string, dryRun: boolean): Promise<void> => {
  console.log('\n── 일정 마이그레이션 ──');

  // 전체 일정 조회 (필터 없이)
  const pages = await queryAllPages(client, dbId);
  console.log(`일정: ${pages.length}개 발견`);

  if (dryRun) return;

  let count = 0;
  for (const page of pages) {
    const title = parseTitle(page);
    if (!title) continue;

    const date = parseDate(page);
    const status = parseSelect(page, '상태') ?? 'todo';
    const categories = parseMultiSelect(page, '카테고리');
    const category = categories[0] ?? null; // 첫 번째 값만
    const memo = parseRichText(page, '메모') || null;

    const dateStr = date ? date.start.slice(0, 10) : null;
    const endDateStr = date?.end ? date.end.slice(0, 10) : null;

    await query(
      `INSERT INTO schedules (title, date, end_date, status, category, memo)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [title, dateStr, endDateStr, status, category, memo],
    );
    count++;
  }
  console.log(`일정 INSERT 완료: ${count}개`);
};

const migrateSleep = async (client: NotionClient, dbId: string, dryRun: boolean): Promise<void> => {
  console.log('\n── 수면 마이그레이션 ──');

  const pages = await queryAllPages(client, dbId);
  console.log(`수면: ${pages.length}개 발견`);

  if (dryRun) return;

  let count = 0;
  for (const page of pages) {
    const date = parseDate(page);
    if (!date) continue;

    const dateStr = date.start.slice(0, 10);
    const bedtime = parseRichText(page, '취침');
    const wakeTime = parseRichText(page, '기상');
    const durationMinutes = parseNumber(page, '수면시간');
    const memo = parseRichText(page, '메모') || null;

    if (!bedtime || !wakeTime) {
      console.warn(`  [SKIP] 수면 데이터 불완전: ${dateStr}`);
      continue;
    }

    await query(
      `INSERT INTO sleep_records (date, bedtime, wake_time, duration_minutes, memo)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (date) DO NOTHING`,
      [dateStr, bedtime, wakeTime, durationMinutes, memo],
    );
    count++;
  }
  console.log(`수면 INSERT 완료: ${count}개`);
};

// ─── 메인 ─────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) console.log('🔍 DRY RUN 모드 — 데이터를 실제로 넣지 않습니다.\n');

  // 환경변수 확인
  const notionApiKey = process.env['NOTION_API_KEY'];
  const routineDbId = process.env['NOTION_ROUTINE_DB_ID'];
  const scheduleDbId = process.env['NOTION_SCHEDULE_DB_ID'];
  const sleepDbId = process.env['NOTION_SLEEP_DB_ID'];
  const dbUrl = process.env['DATABASE_URL'];

  if (!notionApiKey || !routineDbId || !scheduleDbId || !dbUrl) {
    console.error('필수 환경변수 누락: NOTION_API_KEY, NOTION_ROUTINE_DB_ID, NOTION_SCHEDULE_DB_ID, DATABASE_URL');
    process.exit(1);
  }

  // Notion 클라이언트
  const notion = new NotionClient({ auth: notionApiKey, notionVersion: NOTION_API_VERSION });

  // DB 연결
  await connectDB(dbUrl);

  try {
    await migrateRoutines(notion, routineDbId, dryRun);
    await migrateSchedules(notion, scheduleDbId, dryRun);

    if (sleepDbId) {
      await migrateSleep(notion, sleepDbId, dryRun);
    } else {
      console.log('\n── 수면 마이그레이션 스킵 (NOTION_SLEEP_DB_ID 미설정) ──');
    }

    // 결과 요약
    if (!dryRun) {
      console.log('\n── 마이그레이션 결과 ──');
      const tables = ['routine_templates', 'routine_records', 'schedules', 'sleep_records'];
      for (const table of tables) {
        const result = await query<{ count: string }>(`SELECT COUNT(*) FROM ${table}`);
        console.log(`  ${table}: ${result.rows[0]?.count ?? 0}개`);
      }
    }
  } finally {
    await disconnectDB();
  }

  console.log('\nDone.');
};

void main();
