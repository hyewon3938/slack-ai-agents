import { describe, it, expect } from 'vitest';
import { computeWeekLayout, WEEK_START } from '../calendar-utils';
import type { ScheduleRow } from '@/features/schedule/lib/types';

// ─── 헬퍼 ───────────────────────────────────────────────

const makeSchedule = (overrides: Partial<ScheduleRow> = {}): ScheduleRow => ({
  id: 1,
  title: '테스트 일정',
  date: '2026-03-09',
  end_date: null,
  status: 'todo',
  category: null,
  subcategory: null,
  memo: null,
  important: false,
  ...overrides,
});

/** 2026-03-09(월) ~ 2026-03-15(일) 주간 */
const makeWeekDays = (): Date[] => {
  const dates: Date[] = [];
  for (let i = 9; i <= 15; i++) {
    dates.push(new Date(`2026-03-${String(i).padStart(2, '0')}T00:00:00`));
  }
  return dates;
};

// ─── WEEK_START ─────────────────────────────────────────

describe('WEEK_START', () => {
  it('월요일(1)로 설정되어 있다', () => {
    expect(WEEK_START).toBe(1);
  });
});

// ─── computeWeekLayout ──────────────────────────────────

describe('computeWeekLayout', () => {
  const weekDays = makeWeekDays();

  it('빈 일정 배열에서 빈 결과를 반환한다', () => {
    const result = computeWeekLayout(weekDays, []);
    expect(result.spans).toHaveLength(0);
    expect(result.singleDay.size).toBe(0);
    expect(result.laneCount).toBe(0);
    expect(result.laneCountPerDay).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  // ─── 단일 일정 ─────────────────────────────────────

  it('단일 일정을 singleDay에 분류한다', () => {
    const schedules = [makeSchedule({ id: 1, date: '2026-03-10' })];
    const result = computeWeekLayout(weekDays, schedules);

    expect(result.spans).toHaveLength(0);
    expect(result.singleDay.has('2026-03-10')).toBe(true);
    expect(result.singleDay.get('2026-03-10')).toHaveLength(1);
  });

  it('같은 날 여러 일정을 상태순으로 정렬한다', () => {
    const schedules = [
      makeSchedule({ id: 1, date: '2026-03-10', status: 'done' }),
      makeSchedule({ id: 2, date: '2026-03-10', status: 'in-progress' }),
      makeSchedule({ id: 3, date: '2026-03-10', status: 'todo' }),
    ];
    const result = computeWeekLayout(weekDays, schedules);
    const items = result.singleDay.get('2026-03-10')!;

    expect(items.map((i) => i.status)).toEqual(['in-progress', 'todo', 'done']);
  });

  it('주간 범위 밖 일정은 무시한다', () => {
    const schedules = [
      makeSchedule({ id: 1, date: '2026-03-01' }),
      makeSchedule({ id: 2, date: '2026-03-20' }),
    ];
    const result = computeWeekLayout(weekDays, schedules);

    expect(result.singleDay.size).toBe(0);
    expect(result.spans).toHaveLength(0);
  });

  it('date가 null인 일정은 무시한다', () => {
    const schedules = [makeSchedule({ id: 1, date: null })];
    const result = computeWeekLayout(weekDays, schedules);

    expect(result.singleDay.size).toBe(0);
    expect(result.spans).toHaveLength(0);
  });

  // ─── 다일(스패닝) 일정 ────────────────────────────

  it('다일 일정을 spans에 분류한다', () => {
    const schedules = [
      makeSchedule({ id: 1, date: '2026-03-10', end_date: '2026-03-12' }),
    ];
    const result = computeWeekLayout(weekDays, schedules);

    expect(result.spans).toHaveLength(1);
    expect(result.spans[0]!.startCol).toBe(1); // 화(10일) = col 1
    expect(result.spans[0]!.endCol).toBe(3);   // 목(12일) = col 3
    expect(result.spans[0]!.lane).toBe(0);
  });

  it('주간 시작 전에 시작하는 다일 일정을 클램핑한다', () => {
    const schedules = [
      makeSchedule({ id: 1, date: '2026-03-07', end_date: '2026-03-11' }),
    ];
    const result = computeWeekLayout(weekDays, schedules);

    expect(result.spans).toHaveLength(1);
    expect(result.spans[0]!.startCol).toBe(0);  // 주 시작(월)으로 클램핑
    expect(result.spans[0]!.endCol).toBe(2);    // 수(11일)
    expect(result.spans[0]!.startsBeforeWeek).toBe(true);
    expect(result.spans[0]!.endsAfterWeek).toBe(false);
  });

  it('주간 끝 후에 끝나는 다일 일정을 클램핑한다', () => {
    const schedules = [
      makeSchedule({ id: 1, date: '2026-03-13', end_date: '2026-03-18' }),
    ];
    const result = computeWeekLayout(weekDays, schedules);

    expect(result.spans).toHaveLength(1);
    expect(result.spans[0]!.startCol).toBe(4);  // 금(13일)
    expect(result.spans[0]!.endCol).toBe(6);    // 주 끝(일)으로 클램핑
    expect(result.spans[0]!.startsBeforeWeek).toBe(false);
    expect(result.spans[0]!.endsAfterWeek).toBe(true);
  });

  // ─── 레인 배정 ────────────────────────────────────

  it('겹치지 않는 다일 일정은 같은 레인에 배정한다', () => {
    const schedules = [
      makeSchedule({ id: 1, date: '2026-03-09', end_date: '2026-03-10' }),
      makeSchedule({ id: 2, date: '2026-03-12', end_date: '2026-03-13' }),
    ];
    const result = computeWeekLayout(weekDays, schedules);

    expect(result.spans).toHaveLength(2);
    expect(result.spans[0]!.lane).toBe(0);
    expect(result.spans[1]!.lane).toBe(0);
    expect(result.laneCount).toBe(1);
  });

  it('겹치는 다일 일정은 다른 레인에 배정한다', () => {
    const schedules = [
      makeSchedule({ id: 1, date: '2026-03-09', end_date: '2026-03-12' }),
      makeSchedule({ id: 2, date: '2026-03-11', end_date: '2026-03-14' }),
    ];
    const result = computeWeekLayout(weekDays, schedules);

    expect(result.spans).toHaveLength(2);
    expect(result.spans[0]!.lane).toBe(0);
    expect(result.spans[1]!.lane).toBe(1);
    expect(result.laneCount).toBe(2);
  });

  it('3개 겹치는 일정에 3개 레인을 배정한다', () => {
    const schedules = [
      makeSchedule({ id: 1, date: '2026-03-09', end_date: '2026-03-13' }),
      makeSchedule({ id: 2, date: '2026-03-10', end_date: '2026-03-14' }),
      makeSchedule({ id: 3, date: '2026-03-11', end_date: '2026-03-15' }),
    ];
    const result = computeWeekLayout(weekDays, schedules);

    expect(result.spans).toHaveLength(3);
    const lanes = result.spans.map((s) => s.lane);
    expect(new Set(lanes).size).toBe(3);
    expect(result.laneCount).toBe(3);
  });

  // ─── 혼합 ─────────────────────────────────────────

  it('다일 + 단일 일정을 동시에 처리한다', () => {
    const schedules = [
      makeSchedule({ id: 1, date: '2026-03-09', end_date: '2026-03-11' }),
      makeSchedule({ id: 2, date: '2026-03-10' }),
      makeSchedule({ id: 3, date: '2026-03-12' }),
    ];
    const result = computeWeekLayout(weekDays, schedules);

    expect(result.spans).toHaveLength(1);
    expect(result.singleDay.size).toBe(2);
  });

  it('end_date가 date와 같으면 단일 일정으로 처리한다', () => {
    const schedules = [
      makeSchedule({ id: 1, date: '2026-03-10', end_date: '2026-03-10' }),
    ];
    const result = computeWeekLayout(weekDays, schedules);

    expect(result.spans).toHaveLength(0);
    expect(result.singleDay.has('2026-03-10')).toBe(true);
  });

  // ─── laneCountPerDay ────────────────────────────────

  it('기간일정이 지나는 요일만 레인 수를 가진다', () => {
    // 화~수(col 1~2) 기간일정
    const schedules = [
      makeSchedule({ id: 1, date: '2026-03-10', end_date: '2026-03-11' }),
    ];
    const result = computeWeekLayout(weekDays, schedules);

    // 월(0)=0, 화(1)=1, 수(2)=1, 목~일(3~6)=0
    expect(result.laneCountPerDay).toEqual([0, 1, 1, 0, 0, 0, 0]);
  });

  it('겹치는 기간일정이 있는 요일만 높은 레인 수를 가진다', () => {
    // 화~수(col 1~2) lane0 + 목~토(col 3~5) lane0 + 금~토(col 4~5) lane1
    const schedules = [
      makeSchedule({ id: 1, date: '2026-03-10', end_date: '2026-03-11' }),
      makeSchedule({ id: 2, date: '2026-03-12', end_date: '2026-03-14' }),
      makeSchedule({ id: 3, date: '2026-03-13', end_date: '2026-03-14' }),
    ];
    const result = computeWeekLayout(weekDays, schedules);

    // 월(0)=0, 화(1)=1, 수(2)=1, 목(3)=1, 금(4)=2, 토(5)=2, 일(6)=0
    expect(result.laneCountPerDay).toEqual([0, 1, 1, 1, 2, 2, 0]);
  });

  it('겹치지 않는 기간일정이 같은 레인을 공유하면 각 요일 레인 수는 1이다', () => {
    // 월~화(col 0~1) + 목~금(col 3~4) — 같은 레인 0
    const schedules = [
      makeSchedule({ id: 1, date: '2026-03-09', end_date: '2026-03-10' }),
      makeSchedule({ id: 2, date: '2026-03-12', end_date: '2026-03-13' }),
    ];
    const result = computeWeekLayout(weekDays, schedules);

    expect(result.laneCountPerDay).toEqual([1, 1, 0, 1, 1, 0, 0]);
  });
});
