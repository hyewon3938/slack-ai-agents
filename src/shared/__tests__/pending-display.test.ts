import { describe, it, expect } from 'vitest';
import {
  formatAffectedRows,
  extractTargetTable,
  extractAffectedDates,
} from '../pending-display.js';

describe('formatAffectedRows', () => {
  it('schedules: 카테고리별 그룹핑, 제목에 중요 표시', () => {
    const rows = [
      { title: '회의', category: '업무', important: true },
      { title: '보고서', category: '업무', important: false },
      { title: '장보기', category: '생활', important: false },
    ];
    const groups = formatAffectedRows('schedules', rows);
    expect(groups).toHaveLength(2);

    const 업무 = groups.find((g) => g.header === '업무');
    const 생활 = groups.find((g) => g.header === '생활');
    expect(업무?.items).toEqual(['회의 ★', '보고서']);
    expect(생활?.items).toEqual(['장보기']);
  });

  it('schedules: category null이면 미분류', () => {
    const groups = formatAffectedRows('schedules', [
      { title: '기타', category: null, important: false },
    ]);
    expect(groups[0]?.header).toBe('미분류');
  });

  it('schedules: title null이면 (제목 없음)', () => {
    const groups = formatAffectedRows('schedules', [
      { title: null, category: '업무', important: false },
    ]);
    expect(groups[0]?.items).toEqual(['(제목 없음)']);
  });

  it('routine_records: date + template_id 포맷', () => {
    const groups = formatAffectedRows('routine_records', [
      { date: '2026-04-01', template_id: 7, completed: true },
      { date: '2026-04-02', template_id: 8, completed: false },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toEqual(['2026-04-01 루틴 #7 ✓', '2026-04-02 루틴 #8']);
  });

  it('routine_templates: name + time_slot', () => {
    const groups = formatAffectedRows('routine_templates', [
      { name: '운동', time_slot: '낮' },
      { name: '독서', time_slot: null },
    ]);
    expect(groups[0]?.items).toEqual(['운동 (낮)', '독서']);
  });

  it('sleep_records: 날짜 + 타입 + 시간 범위', () => {
    const groups = formatAffectedRows('sleep_records', [
      { date: '2026-04-01', sleep_type: 'night', bedtime: '23:00', wake_time: '07:00' },
      { date: '2026-04-01', sleep_type: 'nap', bedtime: '14:00', wake_time: '15:00' },
    ]);
    expect(groups[0]?.items).toEqual([
      '2026-04-01 밤잠 23:00~07:00',
      '2026-04-01 낮잠 14:00~15:00',
    ]);
  });

  it('sleep_events: 중간 기상 포맷', () => {
    const groups = formatAffectedRows('sleep_events', [
      { date: '2026-04-01', event_time: '03:30' },
    ]);
    expect(groups[0]?.items).toEqual(['2026-04-01 03:30 중간 기상']);
  });

  it('reminders: title + time + frequency', () => {
    const groups = formatAffectedRows('reminders', [
      { title: '약 먹기', time_value: '09:00', frequency: '매일' },
      { title: '결제', time_value: '15:00', frequency: null },
    ]);
    expect(groups[0]?.items).toEqual(['약 먹기 — 09:00 (매일)', '결제 — 15:00']);
  });

  it('notification_settings: label 우선, 없으면 slot_name', () => {
    const groups = formatAffectedRows('notification_settings', [
      { label: '아침 체크', slot_name: null, time_value: '09:00' },
      { label: null, slot_name: '밤 체크', time_value: '23:00' },
    ]);
    expect(groups[0]?.items).toEqual(['아침 체크 — 09:00', '밤 체크 — 23:00']);
  });

  it('custom_instructions: 60자 초과 시 … 트렁케이트', () => {
    const long = 'a'.repeat(100);
    const groups = formatAffectedRows('custom_instructions', [
      { instruction: long, category: '일반' },
      { instruction: '짧은 지시사항', category: null },
    ]);
    expect(groups[0]?.items[0]).toBe(`[일반] ${'a'.repeat(60)}…`);
    expect(groups[0]?.items[1]).toBe('짧은 지시사항');
  });

  it('categories: name + type', () => {
    const groups = formatAffectedRows('categories', [
      { name: '업무', type: 'task' },
      { name: '약속', type: 'event' },
    ]);
    expect(groups[0]?.items).toEqual(['업무 (task)', '약속 (event)']);
  });

  it('미지원 테이블은 generic fallback', () => {
    const groups = formatAffectedRows('unknown_table', [{ foo: 1 }, { foo: 2 }]);
    expect(groups[0]?.items).toEqual(['row 1', 'row 2']);
  });
});

describe('extractTargetTable', () => {
  it('DELETE FROM table', () => {
    expect(extractTargetTable('DELETE FROM schedules WHERE id = 1')).toBe('schedules');
  });

  it('UPDATE table', () => {
    expect(extractTargetTable("UPDATE schedules SET status = 'done' WHERE id = 1")).toBe(
      'schedules',
    );
  });

  it('INSERT INTO table', () => {
    expect(extractTargetTable("INSERT INTO reminders (title) VALUES ('x')")).toBe('reminders');
  });

  it('대소문자 무시 + 소문자 반환', () => {
    expect(extractTargetTable('delete FROM Schedules')).toBe('schedules');
    expect(extractTargetTable('Update ROUTINE_RECORDS SET completed = true')).toBe(
      'routine_records',
    );
  });

  it('주석 안 FROM은 무시', () => {
    expect(extractTargetTable('-- FROM fake\nDELETE FROM schedules')).toBe('schedules');
    expect(extractTargetTable('/* FROM fake */ DELETE FROM schedules')).toBe('schedules');
  });

  it('문자열 리터럴 안 FROM은 무시', () => {
    expect(extractTargetTable("DELETE FROM schedules WHERE memo = 'FROM fake'")).toBe('schedules');
  });

  it('매치 없으면 null', () => {
    expect(extractTargetTable('SELECT 1')).toBe(null);
    expect(extractTargetTable('')).toBe(null);
  });
});

describe('extractAffectedDates', () => {
  it('date 컬럼 값들을 중복 없이 반환', () => {
    const dates = extractAffectedDates([
      { date: '2026-04-01' },
      { date: '2026-04-02' },
      { date: '2026-04-01' },
    ]);
    expect(dates.sort()).toEqual(['2026-04-01', '2026-04-02']);
  });

  it('date 없는 row는 무시', () => {
    const dates = extractAffectedDates([
      { title: '회의' },
      { date: '2026-04-01' },
      { date: null },
      { date: '' },
    ]);
    expect(dates).toEqual(['2026-04-01']);
  });

  it('빈 배열이면 빈 배열 반환', () => {
    expect(extractAffectedDates([])).toEqual([]);
  });
});
