import { format } from 'date-fns';
import type { ScheduleRow, CategoryRow } from '@/lib/types';
import { compareSchedulePriority } from '@/lib/types';

/** 주간 시작 요일: 1 = 월요일 */
export const WEEK_START = 1 as const;

export interface WeekSpan {
  schedule: ScheduleRow;
  startCol: number;
  endCol: number;
  lane: number;
  startsBeforeWeek: boolean;
  endsAfterWeek: boolean;
}

export interface WeekLayout {
  spans: WeekSpan[];
  singleDay: Map<string, ScheduleRow[]>;
  laneCount: number;
  /** 요일별(0~6) 해당 열을 지나는 기간일정의 최대 레인 수 */
  laneCountPerDay: number[];
}

/**
 * 한 주의 일정을 스패닝(다일) / 단일 일정으로 분리하고
 * 스패닝 일정에 레인(세로 위치)을 배정한다.
 */
export function computeWeekLayout(weekDays: Date[], schedules: ScheduleRow[], categories: CategoryRow[] = []): WeekLayout {
  const weekDateStrs = weekDays.map((d) => format(d, 'yyyy-MM-dd'));
  const weekStart = weekDateStrs[0]!;
  const weekEnd = weekDateStrs[6]!;

  const spans: WeekSpan[] = [];
  const singleDay = new Map<string, ScheduleRow[]>();
  const lanes: boolean[][] = [];

  const relevant = schedules.filter((s) => {
    if (!s.date) return false;
    if (s.end_date && s.end_date > s.date) {
      return s.date <= weekEnd && s.end_date >= weekStart;
    }
    return s.date >= weekStart && s.date <= weekEnd;
  });

  // 다일 일정 먼저 (시작일 빠른 순, 같으면 긴 기간 우선), 그 다음 단일 일정
  relevant.sort((a, b) => {
    const aMulti = !!(a.end_date && a.end_date > a.date!);
    const bMulti = !!(b.end_date && b.end_date > b.date!);
    if (aMulti !== bMulti) return aMulti ? -1 : 1;
    if (aMulti && bMulti) {
      const cmp = a.date!.localeCompare(b.date!);
      if (cmp !== 0) return cmp;
      return b.end_date!.localeCompare(a.end_date!);
    }
    return (a.date ?? '').localeCompare(b.date ?? '');
  });

  for (const s of relevant) {
    if (s.end_date && s.end_date > s.date!) {
      const clampedStart = s.date! < weekStart ? weekStart : s.date!;
      const clampedEnd = s.end_date > weekEnd ? weekEnd : s.end_date;

      const startCol = weekDateStrs.indexOf(clampedStart);
      const endCol = weekDateStrs.indexOf(clampedEnd);
      if (startCol === -1 || endCol === -1) continue;

      // 첫 번째 빈 레인 찾기
      let lane = 0;
      while (true) {
        if (!lanes[lane]) lanes[lane] = Array.from({ length: 7 }, () => false);
        const occupied = lanes[lane]!.slice(startCol, endCol + 1).some(Boolean);
        if (!occupied) break;
        lane++;
      }

      if (!lanes[lane]) lanes[lane] = Array.from({ length: 7 }, () => false);
      for (let c = startCol; c <= endCol; c++) {
        lanes[lane]![c] = true;
      }

      const startsBeforeWeek = s.date! < weekStart;
      const endsAfterWeek = s.end_date! > weekEnd;
      spans.push({ schedule: s, startCol, endCol, lane, startsBeforeWeek, endsAfterWeek });
    } else {
      const dateStr = s.date!;
      if (!singleDay.has(dateStr)) singleDay.set(dateStr, []);
      singleDay.get(dateStr)!.push(s);
    }
  }

  // 단일 일정 우선순위 정렬: 중요 → 카테고리순 → 상태순
  for (const [, items] of singleDay) {
    items.sort((a, b) => compareSchedulePriority(a, b, categories));
  }

  // 요일별 스페이서: 해당 열을 실제로 점유하는 최대 레인 수
  const laneCountPerDay = Array.from({ length: 7 }, (_, col) => {
    let maxLane = -1;
    for (let l = 0; l < lanes.length; l++) {
      if (lanes[l]![col]) maxLane = l;
    }
    return maxLane + 1;
  });

  return { spans, singleDay, laneCount: lanes.length, laneCountPerDay };
}
