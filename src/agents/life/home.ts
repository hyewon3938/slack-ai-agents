/**
 * Slack App Home 탭 — 오늘의 일정, 루틴, 수면 대시보드.
 * app_home_opened 이벤트 시 views.publish로 갱신.
 */

import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/types';
import { getTodayISO } from './prompt.js';
import {
  formatDateShort,
  buildRoutineBlocks,
  buildScheduleBlocks,
  buildSleepBlocks,
} from './blocks.js';
import {
  queryTodayRecords,
  queryTodaySchedules,
  queryLatestSleep,
} from '../../shared/life-queries.js';
import { createTodayRecords } from '../../cron/life-cron.js';

// ─── KST 시각 헬퍼 ──────────────────────────────────

/** KST(UTC+9) 기준 현재 시각의 HH:MM 문자열 */
const getKSTTimeString = (): string => {
  const now = new Date();
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000);
  const hh = String(kst.getHours()).padStart(2, '0');
  const mm = String(kst.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

// ─── Home 탭 빌드 ───────────────────────────────────

/** Home 탭 뷰 발행 */
export const publishHomeView = async (
  client: WebClient,
  userId: string,
): Promise<void> => {
  const today = getTodayISO();

  // 오늘 루틴 레코드 보장 (없으면 생성)
  await createTodayRecords(today);

  const [records, schedules, sleep] = await Promise.all([
    queryTodayRecords(today),
    queryTodaySchedules(today),
    queryLatestSleep(),
  ]);

  const blocks: KnownBlock[] = [];

  // 헤더
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `${formatDateShort(today)} 대시보드`, emoji: true },
  });

  // 일정 섹션
  blocks.push({ type: 'divider' });
  if (schedules.length > 0) {
    const { blocks: scheduleBlocks } = buildScheduleBlocks(schedules, today);
    blocks.push(...scheduleBlocks);
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*일정*\n오늘 일정 없음' },
    });
  }

  // 루틴 섹션
  blocks.push({ type: 'divider' });
  if (records.length > 0) {
    const { blocks: routineBlocks } = buildRoutineBlocks(records, today);
    blocks.push(...routineBlocks);
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*루틴*\n오늘 루틴 없음' },
    });
  }

  // 수면 섹션
  blocks.push({ type: 'divider' });
  blocks.push(...buildSleepBlocks(sleep));

  // 업데이트 시각
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `마지막 업데이트: ${getKSTTimeString()}` }],
  });

  await client.views.publish({
    user_id: userId,
    view: {
      type: 'home',
      blocks,
    },
  });
};

// ─── 이벤트 등록 ────────────────────────────────────

/** app_home_opened 이벤트 핸들러 등록 */
export const registerHomeTab = (app: App): void => {
  app.event('app_home_opened', async ({ event, client }) => {
    if (event.tab !== 'home') return;
    try {
      await publishHomeView(client, event.user);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Home] 탭 갱신 오류: ${msg}`);
    }
  });
};
