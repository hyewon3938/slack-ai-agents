import { describe, it, expect } from 'vitest';
import type { ScheduleRow } from '../../../../shared/life/queries-schedule.js';
import { formatDateShort } from '../../../../shared/kst.js';
import { buildNightScheduleText, buildYesterdayIncompleteText } from '../schedule-text.js';

const NIGHT_HEADER = '오늘 아직 못 끝낸 일정이야. 내일로 넘길 건 정리해둬!';
const YESTERDAY_HEADER = '어제 못 끝낸 일정이야. 오늘로 넘길 건 정리해둬!';

const makeSchedule = (overrides: Partial<ScheduleRow> = {}): ScheduleRow => ({
  id: 1,
  title: '회의',
  date: '2026-03-08',
  end_date: null,
  status: 'todo',
  category_id: 1,
  category_name: '업무',
  category_type: 'task',
  top_category_name: '업무',
  memo: null,
  important: false,
  ...overrides,
});

describe('buildNightScheduleText', () => {
  const today = '2026-03-08';

  it('일정이 없으면 null', () => {
    expect(buildNightScheduleText([], today)).toBeNull();
  });

  it('완료·취소 일정만 있으면 null', () => {
    const items = [
      makeSchedule({ id: 1, status: 'done' }),
      makeSchedule({ id: 2, status: 'cancelled' }),
    ];
    expect(buildNightScheduleText(items, today)).toBeNull();
  });

  it('event 타입은 미완료여도 제외', () => {
    const items = [makeSchedule({ category_type: 'event', top_category_name: '약속' })];
    expect(buildNightScheduleText(items, today)).toBeNull();
  });

  it('완료와 미완료가 섞이면 미완료만 카테고리별로 묶어 출력', () => {
    const items = [
      makeSchedule({ id: 1, title: '보고서', important: true }),
      makeSchedule({ id: 2, title: '정리 끝', status: 'done' }),
      makeSchedule({ id: 3, title: '메모 정리', top_category_name: null, category_id: null }),
      makeSchedule({ id: 4, title: '장보기', status: 'in-progress', top_category_name: '개인' }),
      makeSchedule({ id: 5, title: '빨래', top_category_name: '개인' }),
    ];
    expect(buildNightScheduleText(items, today)).toBe(
      [
        NIGHT_HEADER,
        '',
        '[개인]',
        '► 장보기',
        '빨래',
        '',
        '[업무]',
        '보고서 ★',
        '',
        '[미분류]',
        '메모 정리',
      ].join('\n'),
    );
  });

  it('기간 일정은 end_date가 오늘 이후면 진행 중으로 보고 제외', () => {
    const items = [
      makeSchedule({ id: 1, date: '2026-03-06', end_date: '2026-03-08' }),
      makeSchedule({ id: 2, date: '2026-03-06', end_date: '2026-03-10' }),
    ];
    expect(buildNightScheduleText(items, today)).toBeNull();
  });

  it('end_date가 지난 기간 일정은 기간을 붙여 포함', () => {
    const items = [
      makeSchedule({ title: '출장 준비', date: '2026-03-02', end_date: '2026-03-07' }),
    ];
    const text = buildNightScheduleText(items, today);
    expect(text).toContain(
      `출장 준비 ${formatDateShort('2026-03-02')}~${formatDateShort('2026-03-07')}`,
    );
  });
});

describe('buildYesterdayIncompleteText', () => {
  const yesterday = '2026-03-07';
  const today = '2026-03-08';

  it('미완료가 없으면 null', () => {
    const items = [makeSchedule({ date: yesterday, status: 'done' })];
    expect(buildYesterdayIncompleteText(items, yesterday, today)).toBeNull();
  });

  it('어제 헤더로 미완료 일정을 출력', () => {
    const items = [makeSchedule({ title: '보고서', date: yesterday })];
    expect(buildYesterdayIncompleteText(items, yesterday, today)).toBe(
      [YESTERDAY_HEADER, '', '[업무]', '보고서'].join('\n'),
    );
  });

  it('진행 중 판단은 today 기준 — 어제 끝난 기간 일정은 포함, 오늘까지 이어지는 일정은 제외', () => {
    const items = [
      makeSchedule({ id: 1, title: '어제 마감', date: '2026-03-05', end_date: yesterday }),
      makeSchedule({ id: 2, title: '오늘 마감', date: '2026-03-05', end_date: today }),
    ];
    const text = buildYesterdayIncompleteText(items, yesterday, today);
    expect(text).toContain('어제 마감');
    expect(text).not.toContain('오늘 마감');
  });
});
