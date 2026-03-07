/**
 * 오늘 루틴 기록 수동 생성 스크립트.
 * 아침 크론이 실패했을 때 수동으로 실행.
 *
 * 사용법: node --import tsx scripts/create-today-routines.ts
 */

import dotenv from 'dotenv';
import { createNotionClient } from '../src/shared/notion.js';
import {
  queryRoutineTemplates,
  queryTodayRoutineRecords,
  queryLastRecordDate,
  createRoutineRecord,
  shouldCreateToday,
} from '../src/shared/routine-notion.js';

dotenv.config();

const NOTION_API_KEY = process.env['NOTION_API_KEY'];
const ROUTINE_DB_ID = process.env['NOTION_ROUTINE_DB_ID'];

if (!NOTION_API_KEY || !ROUTINE_DB_ID) {
  console.error('NOTION_API_KEY, NOTION_ROUTINE_DB_ID 환경변수가 필요합니다.');
  process.exit(1);
}

/** KST 기준 오늘 날짜 */
const getTodayISO = (): string => {
  const now = new Date();
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000);
  const yyyy = kst.getFullYear();
  const mm = String(kst.getMonth() + 1).padStart(2, '0');
  const dd = String(kst.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const main = async (): Promise<void> => {
  const notionClient = createNotionClient(NOTION_API_KEY);
  const today = getTodayISO();

  console.log(`\n=== 루틴 기록 생성 (${today}) ===\n`);

  // 1. 템플릿 조회
  const templates = await queryRoutineTemplates(notionClient, ROUTINE_DB_ID);
  console.log(`활성 템플릿: ${templates.length}개`);
  for (const t of templates) {
    console.log(`  - ${t.title} [${t.timeSlot}] (${t.frequency})`);
  }

  // 2. 기존 기록 조회
  const existing = await queryTodayRoutineRecords(notionClient, ROUTINE_DB_ID, today);
  const existingKeys = new Set(existing.map((r) => `${r.title}:${r.timeSlot}`));
  console.log(`\n기존 기록: ${existing.length}개`);
  for (const r of existing) {
    console.log(`  - ${r.title} [${r.timeSlot}] ${r.completed ? '(완료)' : '(미완료)'}`);
  }

  // 3. 새로 생성할 템플릿 필터링
  const candidates = templates.filter(
    (t) => !existingKeys.has(`${t.title}:${t.timeSlot}`),
  );

  const toCreate = [];
  for (const t of candidates) {
    if (t.frequency === '매일') {
      toCreate.push(t);
    } else {
      const lastDate = await queryLastRecordDate(notionClient, ROUTINE_DB_ID, t.title, t.timeSlot);
      if (shouldCreateToday(t.frequency, lastDate, today)) {
        toCreate.push(t);
      } else {
        console.log(`  (건너뜀: ${t.title} — 빈도 조건 미충족, 마지막: ${lastDate ?? '없음'})`);
      }
    }
  }

  // 4. 기록 생성
  if (toCreate.length === 0) {
    console.log('\n새로 생성할 기록이 없습니다.');
    return;
  }

  console.log(`\n생성할 기록: ${toCreate.length}개`);
  let created = 0;
  for (const t of toCreate) {
    try {
      await createRoutineRecord(notionClient, ROUTINE_DB_ID, t.title, t.timeSlot, today, t.frequency);
      console.log(`  + ${t.title} [${t.timeSlot}] 생성 완료`);
      created++;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`  ! ${t.title} [${t.timeSlot}] 생성 실패: ${msg}`);
    }
  }

  console.log(`\n=== 완료: ${created}/${toCreate.length}개 생성 ===\n`);
};

main().catch((error: unknown) => {
  console.error('스크립트 실행 오류:', error);
  process.exit(1);
});
