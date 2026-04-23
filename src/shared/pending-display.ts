/**
 * modify_db 확인 플로우에서 테이블별로 표시를 담당한다.
 * - formatAffectedRows: 영향받을 row 1건을 "표시용 문자열"로 변환 (확인 카드)
 * - loadCurrentStateBlocks: 실행 완료 후 "현재 상태"를 Block Kit으로 반환
 */
import type { KnownBlock } from '@slack/types';
import {
  queryTodaySchedules,
  queryBacklogSchedules,
  queryTodayRecords,
  queryActiveTemplates,
  querySleepForHome,
  querySleepEventsForHome,
} from './life-queries.js';
import {
  buildScheduleBlocks,
  buildRoutineBlocks,
  buildSleepBlocks,
  formatSchedulesAsText,
} from '../agents/life/blocks.js';
import { getTodayISO } from './kst.js';
import { query } from './db.js';

export type AffectedRow = Record<string, unknown>;

export interface DisplayGroup {
  /** 카테고리/그룹 헤더 (없으면 null) */
  header: string | null;
  /** 리스트 항목들 */
  items: string[];
}

/** 영향받을 row들을 테이블에 맞게 그룹핑된 리스트로 변환 */
export const formatAffectedRows = (tableName: string, rows: AffectedRow[]): DisplayGroup[] => {
  switch (tableName) {
    case 'schedules':
      return formatSchedules(rows);
    case 'routine_records':
      return formatRoutineRecords(rows);
    case 'routine_templates':
      return formatRoutineTemplates(rows);
    case 'sleep_records':
      return formatSleepRecords(rows);
    case 'sleep_events':
      return formatSleepEvents(rows);
    case 'reminders':
      return formatReminders(rows);
    case 'notification_settings':
      return formatNotificationSettings(rows);
    case 'custom_instructions':
      return formatCustomInstructions(rows);
    case 'categories':
      return formatCategories(rows);
    default:
      return [{ header: null, items: rows.map((_, i) => `row ${i + 1}`) }];
  }
};

// schedules: [카테고리] 제목 형식, 카테고리별 그룹
const formatSchedules = (rows: AffectedRow[]): DisplayGroup[] => {
  const groups = new Map<string, string[]>();
  for (const r of rows) {
    const cat = (r['category'] as string | null) ?? '미분류';
    const title = (r['title'] as string | null) ?? '(제목 없음)';
    const important = r['important'] ? ' ★' : '';
    const list = groups.get(cat) ?? [];
    list.push(`${title}${important}`);
    groups.set(cat, list);
  }
  return [...groups.entries()].map(([header, items]) => ({ header, items }));
};

const formatRoutineRecords = (rows: AffectedRow[]): DisplayGroup[] => {
  const items = rows.map((r) => {
    const date = (r['date'] as string | null) ?? '?';
    const tid = r['template_id'] ?? '?';
    const completed = r['completed'] ? ' ✓' : '';
    return `${date} 루틴 #${tid}${completed}`;
  });
  return [{ header: null, items }];
};

const formatRoutineTemplates = (rows: AffectedRow[]): DisplayGroup[] => {
  const items = rows.map((r) => {
    const name = (r['name'] as string | null) ?? '(이름 없음)';
    const slot = (r['time_slot'] as string | null) ?? '';
    return slot ? `${name} (${slot})` : name;
  });
  return [{ header: null, items }];
};

const formatSleepRecords = (rows: AffectedRow[]): DisplayGroup[] => {
  const items = rows.map((r) => {
    const date = (r['date'] as string | null) ?? '?';
    const type = r['sleep_type'] === 'night' ? '밤잠' : '낮잠';
    const bedtime = (r['bedtime'] as string | null) ?? '--';
    const wake = (r['wake_time'] as string | null) ?? '--';
    return `${date} ${type} ${bedtime}~${wake}`;
  });
  return [{ header: null, items }];
};

const formatSleepEvents = (rows: AffectedRow[]): DisplayGroup[] => {
  const items = rows.map((r) => {
    const date = (r['date'] as string | null) ?? '?';
    const time = (r['event_time'] as string | null) ?? '?';
    return `${date} ${time} 중간 기상`;
  });
  return [{ header: null, items }];
};

const formatReminders = (rows: AffectedRow[]): DisplayGroup[] => {
  const items = rows.map((r) => {
    const title = (r['title'] as string | null) ?? '(제목 없음)';
    const time = (r['time_value'] as string | null) ?? '?';
    const freq = (r['frequency'] as string | null) ?? '';
    return freq ? `${title} — ${time} (${freq})` : `${title} — ${time}`;
  });
  return [{ header: null, items }];
};

const formatNotificationSettings = (rows: AffectedRow[]): DisplayGroup[] => {
  const items = rows.map((r) => {
    const label = (r['label'] as string | null) ?? (r['slot_name'] as string | null) ?? '?';
    const time = (r['time_value'] as string | null) ?? '?';
    return `${label} — ${time}`;
  });
  return [{ header: null, items }];
};

const formatCustomInstructions = (rows: AffectedRow[]): DisplayGroup[] => {
  const items = rows.map((r) => {
    const inst = (r['instruction'] as string | null) ?? '';
    const truncated = inst.length > 60 ? inst.slice(0, 60) + '…' : inst;
    const cat = (r['category'] as string | null) ?? '';
    return cat ? `[${cat}] ${truncated}` : truncated;
  });
  return [{ header: null, items }];
};

const formatCategories = (rows: AffectedRow[]): DisplayGroup[] => {
  const items = rows.map((r) => {
    const name = (r['name'] as string | null) ?? '?';
    const type = (r['type'] as string | null) ?? '?';
    return `${name} (${type})`;
  });
  return [{ header: null, items }];
};

// ─── 실행 완료 후 현재 상태 블록 ───────────────────────

export interface CurrentStateContext {
  userId: number;
  /** 영향받은 row에서 추출한 날짜들 (실행 전 row 기준) */
  affectedDates?: string[];
}

/**
 * 실행 완료 후 "현재 상태" 블록. 실패/미지원 테이블이면 null.
 */
export const loadCurrentStateBlocks = async (
  tableName: string,
  ctx: CurrentStateContext,
): Promise<{ text: string; blocks: KnownBlock[] } | null> => {
  const today = getTodayISO();
  switch (tableName) {
    case 'schedules': {
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
    }
    case 'routine_records': {
      const targetDate = ctx.affectedDates?.[0] ?? today;
      const records = await queryTodayRecords(targetDate, ctx.userId);
      return buildRoutineBlocks(records, targetDate);
    }
    case 'routine_templates': {
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
    }
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

/** SQL의 첫 FROM/UPDATE 뒤 테이블명 추출 */
export const extractTargetTable = (sql: string): string | null => {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '');
  const match = /\b(?:FROM|UPDATE|INTO)\s+(\w+)/i.exec(stripped);
  return match?.[1]?.toLowerCase() ?? null;
};

/** 영향 row에서 date 컬럼 값들을 중복 없이 추출 (있는 테이블만) */
export const extractAffectedDates = (rows: AffectedRow[]): string[] => {
  const dates = new Set<string>();
  for (const r of rows) {
    const d = r['date'];
    if (typeof d === 'string' && d.length > 0) dates.add(d);
  }
  return [...dates];
};
