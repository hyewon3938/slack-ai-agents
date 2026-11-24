/**
 * 일정 overflow 메뉴 value 인코딩/파싱과 옵션 조립.
 */

import type { ScheduleRow } from '../../../shared/life/queries-schedule.js';
import {
  POSTPONE_ACTION,
  DELETE_ACTION,
  TOGGLE_IMPORTANT_ACTION,
  MOVE_TO_TODAY_ACTION,
} from './constants.js';

/** overflow value 형식: "scheduleId|newStatus|targetDate" */
export const encodeOverflowValue = (
  scheduleId: number,
  newStatus: string,
  targetDate: string,
): string => `${scheduleId}|${newStatus}|${targetDate}`;

export const parseOverflowValue = (
  value: string,
): { scheduleId: number; newStatus: string; targetDate: string } => {
  const parts = value.split('|');
  return {
    scheduleId: Number(parts[0]),
    newStatus: parts[1] ?? '',
    targetDate: parts[2] ?? '',
  };
};

const STATUS_OPTIONS: { status: string; label: string }[] = [
  { status: 'done', label: '완료' },
  { status: 'in-progress', label: '진행중' },
  { status: 'todo', label: '할일' },
];

export const buildOverflowOptions = (
  item: ScheduleRow,
  targetDate: string,
): Array<{ text: { type: 'plain_text'; text: string }; value: string }> => {
  const currentStatus = item.status ?? 'todo';
  const options = STATUS_OPTIONS.filter((opt) => opt.status !== currentStatus).map((opt) => ({
    text: { type: 'plain_text' as const, text: opt.label },
    value: encodeOverflowValue(item.id, opt.status, targetDate),
  }));

  if (currentStatus !== 'done') {
    options.push({
      text: { type: 'plain_text' as const, text: '내일로 미루기' },
      value: encodeOverflowValue(item.id, POSTPONE_ACTION, targetDate),
    });
  }

  options.push({
    text: { type: 'plain_text' as const, text: item.important ? '중요 해제' : '중요 표시' },
    value: encodeOverflowValue(item.id, TOGGLE_IMPORTANT_ACTION, targetDate),
  });

  options.push({
    text: { type: 'plain_text' as const, text: '삭제하기' },
    value: encodeOverflowValue(item.id, DELETE_ACTION, targetDate),
  });

  return options;
};

/** event 전용 overflow: 중요 표시 + 삭제만 */
export const buildEventOverflowOptions = (
  item: ScheduleRow,
  targetDate: string,
): Array<{ text: { type: 'plain_text'; text: string }; value: string }> => [
  {
    text: { type: 'plain_text' as const, text: item.important ? '중요 해제' : '중요 표시' },
    value: encodeOverflowValue(item.id, TOGGLE_IMPORTANT_ACTION, targetDate),
  },
  {
    text: { type: 'plain_text' as const, text: '삭제하기' },
    value: encodeOverflowValue(item.id, DELETE_ACTION, targetDate),
  },
];

/** backlog 전용 overflow: "오늘로 이동" + "삭제" */
export const buildBacklogOverflowOptions = (
  item: ScheduleRow,
): Array<{ text: { type: 'plain_text'; text: string }; value: string }> => [
  {
    text: { type: 'plain_text' as const, text: '오늘로 이동' },
    value: encodeOverflowValue(item.id, MOVE_TO_TODAY_ACTION, 'backlog'),
  },
  {
    text: { type: 'plain_text' as const, text: '삭제하기' },
    value: encodeOverflowValue(item.id, DELETE_ACTION, 'backlog'),
  },
];
