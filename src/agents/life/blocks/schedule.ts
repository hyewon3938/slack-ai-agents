/**
 * 일정 목록 블록과 텍스트 폴백.
 */

import type { KnownBlock } from '@slack/types';
import { formatDateShort } from '../../../shared/kst.js';
import type { ScheduleRow } from '../../../shared/life/queries-schedule.js';
import { SCHEDULE_ACTION_ID } from './constants.js';
import { groupByCategory, isEventType, formatScheduleTitle } from './schedule-format.js';
import {
  buildOverflowOptions,
  buildEventOverflowOptions,
  buildBacklogOverflowOptions,
} from './schedule-overflow.js';

/**
 * 일정 목록을 줄글(단일 mrkdwn 문자열)로 변환.
 * 프롬프트의 "일정 표시 포맷" 스펙과 동일. 카테고리 헤더 사이 빈 줄.
 */
export const formatSchedulesAsText = (
  items: ScheduleRow[],
  targetDate: string,
  options?: { backlog?: boolean },
): string => {
  const backlog = options?.backlog ?? false;
  const formatted = backlog ? '' : formatDateShort(targetDate);
  const headerLabel = backlog ? `백로그 (${items.length}건)` : `${formatted} 일정`;

  const groups = groupByCategory(items);
  const sections: string[] = [];
  for (const group of groups) {
    const lines = [`*[${group.category}]*`];
    for (const item of group.items) lines.push(formatScheduleTitle(item));
    sections.push(lines.join('\n'));
  }

  if (sections.length === 0) return `*${headerLabel}*\n없음`;
  return `*${headerLabel}*\n\n${sections.join('\n\n')}`;
};

/** 일정 목록 Block Kit 빌드 (카테고리별 그룹핑 + overflow 메뉴) */
export const buildScheduleBlocks = (
  items: ScheduleRow[],
  targetDate: string,
  headerText?: string,
  options?: { compact?: boolean; backlog?: boolean },
): { text: string; blocks: KnownBlock[] } => {
  const blocks: KnownBlock[] = [];
  const backlog = options?.backlog ?? false;
  const formatted = backlog ? '' : formatDateShort(targetDate);
  const compact = options?.compact ?? false;
  const headerLabel = backlog ? `백로그 (${items.length}건)` : `${formatted} 일정`;

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*${headerText ?? headerLabel}*` },
  });

  const groups = groupByCategory(items);

  for (const group of groups) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*[${group.category}]*` },
    });

    if (compact) {
      // compact: overflow 없이
      const batch: string[] = [];
      const flushBatch = (): void => {
        if (batch.length === 0) return;
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: batch.join('\n') },
        });
        batch.length = 0;
      };

      for (const item of group.items) {
        batch.push(formatScheduleTitle(item));
      }
      flushBatch();
    } else {
      // full: overflow 메뉴 포함
      const noOverflowLines: string[] = [];

      const flushNoOverflow = (): void => {
        if (noOverflowLines.length === 0) return;
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: noOverflowLines.join('\n') },
        });
        noOverflowLines.length = 0;
      };

      for (const item of group.items) {
        const titleText = formatScheduleTitle(item);

        if (backlog) {
          // backlog: 모든 항목에 overflow (오늘로 이동 + 삭제)
          flushNoOverflow();
          blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: titleText },
            accessory: {
              type: 'overflow',
              action_id: SCHEDULE_ACTION_ID,
              options: buildBacklogOverflowOptions(item),
            },
          });
        } else if (isEventType(item)) {
          // event: 중요/삭제만
          flushNoOverflow();
          blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: titleText },
            accessory: {
              type: 'overflow',
              action_id: SCHEDULE_ACTION_ID,
              options: buildEventOverflowOptions(item, targetDate),
            },
          });
        } else if (!item.status) {
          noOverflowLines.push(titleText);
        } else {
          // task: 전체 상태변경
          flushNoOverflow();
          blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: titleText },
            accessory: {
              type: 'overflow',
              action_id: SCHEDULE_ACTION_ID,
              options: buildOverflowOptions(item, targetDate),
            },
          });
        }
      }

      flushNoOverflow();
    }
  }

  // 하단 통계 — event 타입 제외
  const tasks = items.filter((i) => !isEventType(i));
  const done = tasks.filter((i) => i.status === 'done').length;

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `${done}/${tasks.length} 완료` }],
  });

  const fallbackText = backlog
    ? `백로그 (${items.length}건)`
    : `${formatted} 일정 (${items.length}개)`;
  return { text: fallbackText, blocks };
};
