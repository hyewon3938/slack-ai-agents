/**
 * modify_db 확인 플로우: 실행 완료 후 "현재 상태"를 테이블별 Block Kit으로 반환한다.
 */

import type { KnownBlock } from '@slack/types';
import { queryTodaySchedules, queryBacklogSchedules } from './life/queries-schedule.js';
import { queryTodayRecords, queryActiveTemplates } from './life/queries-routine.js';
import { querySleepForHome, querySleepEventsForHome } from './life/queries-sleep.js';
import { buildRoutineBlocks } from '../agents/life/blocks/routine.js';
import { buildSleepBlocks } from '../agents/life/blocks/sleep.js';
import { formatSchedulesAsText } from '../agents/life/blocks/schedule.js';
import { getTodayISO } from './kst.js';
import { query } from './db.js';

export interface CurrentStateContext {
  userId: number;
  /** 영향받은 row에서 추출한 날짜들 (실행 전 row 기준) */
  affectedDates?: string[];
}

/** schedules: 영향받은 날짜(또는 백로그) 기준 일정 목록 */
const loadScheduleState = async (
  ctx: CurrentStateContext,
  today: string,
): Promise<{ text: string; blocks: KnownBlock[] }> => {
  const hasBacklog = ctx.affectedDates?.some((d) => !d) ?? false;
  const targetDate = ctx.affectedDates?.find((d) => !!d) ?? today;
  const items = hasBacklog
    ? await queryBacklogSchedules(ctx.userId)
    : await queryTodaySchedules(targetDate, ctx.userId);
  const text = formatSchedulesAsText(items, hasBacklog ? 'backlog' : targetDate, {
    backlog: hasBacklog,
  });
  return {
    text,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
  };
};

/** routine_templates: 활성 루틴 목록 */
const loadRoutineTemplateState = async (
  ctx: CurrentStateContext,
): Promise<{ text: string; blocks: KnownBlock[] }> => {
  const templates = await queryActiveTemplates(ctx.userId);
  const lines = templates.map((t) => `• ${t.name} (${t.time_slot})`);
  return {
    text: `활성 루틴 ${templates.length}개`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*활성 루틴* (${templates.length}개)\n${lines.join('\n') || '없음'}`,
        },
      },
    ],
  };
};

/**
 * 실행 완료 후 "현재 상태" 블록. 실패/미지원 테이블이면 null.
 */
export const loadCurrentStateBlocks = async (
  tableName: string,
  ctx: CurrentStateContext,
): Promise<{ text: string; blocks: KnownBlock[] } | null> => {
  const today = getTodayISO();
  switch (tableName) {
    case 'schedules':
      return loadScheduleState(ctx, today);
    case 'routine_records': {
      const targetDate = ctx.affectedDates?.[0] ?? today;
      const records = await queryTodayRecords(targetDate, ctx.userId);
      return buildRoutineBlocks(records, targetDate);
    }
    case 'routine_templates':
      return loadRoutineTemplateState(ctx);
    case 'sleep_records':
    case 'sleep_events': {
      const targetDate = ctx.affectedDates?.[0] ?? today;
      const [records, events] = await Promise.all([
        querySleepForHome(targetDate, ctx.userId),
        querySleepEventsForHome(targetDate),
      ]);
      return {
        text: `${targetDate} 수면 기록`,
        blocks: buildSleepBlocks(records, events),
      };
    }
    case 'reminders':
      return loadReminderList(ctx.userId);
    case 'notification_settings':
      return loadNotificationList();
    case 'custom_instructions':
      return loadCustomInstructionList(ctx.userId);
    case 'categories':
      return loadCategoryList();
    default:
      return null;
  }
};

/** 활성 리마인더 간단 리스트 */
const loadReminderList = async (
  userId: number,
): Promise<{ text: string; blocks: KnownBlock[] }> => {
  const rows = (
    await query<{ title: string; time_value: string; frequency: string | null }>(
      `SELECT title, time_value, frequency FROM reminders
       WHERE active = true AND user_id = $1
       ORDER BY time_value, title`,
      [userId],
    )
  ).rows;
  const lines = rows.map((r) =>
    r.frequency
      ? `• ${r.title} — ${r.time_value} (${r.frequency})`
      : `• ${r.title} — ${r.time_value}`,
  );
  return {
    text: `활성 리마인더 ${rows.length}개`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*활성 리마인더* (${rows.length}개)\n${lines.join('\n') || '없음'}`,
        },
      },
    ],
  };
};

const loadNotificationList = async (): Promise<{ text: string; blocks: KnownBlock[] }> => {
  const rows = (
    await query<{ label: string; time_value: string; active: boolean }>(
      `SELECT label, time_value, active FROM notification_settings ORDER BY id`,
    )
  ).rows;
  const lines = rows.map((r) => `• ${r.label} — ${r.time_value}${r.active ? '' : ' (비활성)'}`);
  return {
    text: '알림 설정',
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*알림 설정*\n${lines.join('\n')}` },
      },
    ],
  };
};

const loadCustomInstructionList = async (
  userId: number,
): Promise<{ text: string; blocks: KnownBlock[] }> => {
  const rows = (
    await query<{ instruction: string; category: string }>(
      `SELECT instruction, category FROM custom_instructions
       WHERE active = true AND user_id = $1
       ORDER BY category, created_at`,
      [userId],
    )
  ).rows;
  const lines = rows.map((r) => `• [${r.category}] ${r.instruction}`);
  return {
    text: `활성 지시사항 ${rows.length}개`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*활성 지시사항* (${rows.length}개)\n${lines.join('\n') || '없음'}`,
        },
      },
    ],
  };
};

const loadCategoryList = async (): Promise<{ text: string; blocks: KnownBlock[] }> => {
  const rows = (
    await query<{ name: string; type: string }>(
      `SELECT name, type FROM categories ORDER BY sort_order, name`,
    )
  ).rows;
  const lines = rows.map((r) => `• ${r.name} (${r.type})`);
  return {
    text: `카테고리 ${rows.length}개`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*카테고리* (${rows.length}개)\n${lines.join('\n')}`,
        },
      },
    ],
  };
};
