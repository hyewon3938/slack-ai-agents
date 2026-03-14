import { describe, it, expect } from 'vitest';
import type { RoutineRecordRow, ScheduleRow } from '../../../shared/life-queries.js';
import { formatDateShort } from '../../../shared/kst.js';
import {
  buildRoutineBlocks,
  buildFilteredRoutineBlocks,
  buildMorningGreetingBlocks,
  buildNightSummaryBlocks,
  buildScheduleBlocks,
  parseButtonValue,
  parseOverflowValue,
  ROUTINE_ACTION_ID,
  SCHEDULE_ACTION_ID,
} from '../blocks.js';

// ─── 테스트 데이터 ─────────────────────────────────────

const makeRecord = (overrides: Partial<RoutineRecordRow> = {}): RoutineRecordRow => ({
  id: 1,
  template_id: 10,
  date: '2026-03-08',
  completed: false,
  completed_at: null,
  memo: null,
  name: '운동',
  time_slot: '아침',
  frequency: '매일',
  ...overrides,
});

const makeSchedule = (overrides: Partial<ScheduleRow> = {}): ScheduleRow => ({
  id: 1,
  title: '회의',
  date: '2026-03-08',
  end_date: null,
  status: 'todo',
  category: '업무',
  category_type: 'task',
  memo: null,
  important: false,
  ...overrides,
});

// ─── formatDateShort ───────────────────────────────────

describe('formatDateShort', () => {
  it('YYYY-MM-DD → M/D(요일) 형식', () => {
    const result = formatDateShort('2026-03-08');
    expect(result).toMatch(/3\/8\([일월화수목금토]\)/);
  });
});

// ─── parseButtonValue ──────────────────────────────────

describe('parseButtonValue', () => {
  it('recordId만 파싱', () => {
    const { recordId, filter } = parseButtonValue('42');
    expect(recordId).toBe(42);
    expect(filter).toBeNull();
  });

  it('recordId + 필터 컨텍스트 파싱', () => {
    const { recordId, filter } = parseButtonValue('42|아침,점심|아침');
    expect(recordId).toBe(42);
    expect(filter).not.toBeNull();
    expect(filter?.targetSlots).toEqual(['아침', '점심']);
    expect(filter?.incompleteFrom).toEqual(['아침']);
  });
});

// ─── parseOverflowValue ────────────────────────────────

describe('parseOverflowValue', () => {
  it('scheduleId + status + date 파싱', () => {
    const result = parseOverflowValue('7|done|2026-03-08');
    expect(result.scheduleId).toBe(7);
    expect(result.newStatus).toBe('done');
    expect(result.targetDate).toBe('2026-03-08');
  });
});

// ─── buildRoutineBlocks ────────────────────────────────

describe('buildRoutineBlocks', () => {
  it('시간대별 그룹핑 + 완료 버튼', () => {
    const records = [
      makeRecord({ id: 1, name: '운동', time_slot: '아침' }),
      makeRecord({ id: 2, name: '독서', time_slot: '밤' }),
    ];

    const { text, blocks } = buildRoutineBlocks(records, '2026-03-08');
    expect(text).toContain('루틴 체크');
    expect(text).toContain('0/2');

    // 버튼이 있는 블록 찾기
    const buttonBlocks = blocks.filter((b) => b.type === 'section' && 'accessory' in b);
    expect(buttonBlocks).toHaveLength(2);
  });

  it('완료된 루틴은 취소선 + 체크마크', () => {
    const records = [makeRecord({ id: 1, completed: true })];

    const { blocks } = buildRoutineBlocks(records, '2026-03-08');
    const textBlocks = blocks.filter(
      (b) => b.type === 'section' && 'text' in b && !('accessory' in b),
    );

    const hasStrikethrough = textBlocks.some((b) => {
      if (!('text' in b) || !b.text || typeof b.text === 'string') return false;
      return 'text' in b.text && typeof b.text.text === 'string' && b.text.text.includes('~운동~');
    });
    expect(hasStrikethrough).toBe(true);
  });

  it('완료 통계 표시', () => {
    const records = [
      makeRecord({ id: 1, completed: true }),
      makeRecord({ id: 2, name: '독서', completed: false }),
    ];

    const { text } = buildRoutineBlocks(records, '2026-03-08');
    expect(text).toContain('1/2');
  });

  it('action_id가 life_routine_complete', () => {
    const records = [makeRecord()];
    const { blocks } = buildRoutineBlocks(records, '2026-03-08');

    const buttonBlock = blocks.find((b) => b.type === 'section' && 'accessory' in b);
    expect(buttonBlock).toBeDefined();
    if (buttonBlock && 'accessory' in buttonBlock) {
      const accessory = buttonBlock.accessory as { action_id: string };
      expect(accessory.action_id).toBe(ROUTINE_ACTION_ID);
    }
  });
});

// ─── buildFilteredRoutineBlocks ────────────────────────

describe('buildFilteredRoutineBlocks', () => {
  it('target 시간대만 필터링', () => {
    const records = [
      makeRecord({ id: 1, time_slot: '아침' }),
      makeRecord({ id: 2, time_slot: '점심', name: '점심약' }),
      makeRecord({ id: 3, time_slot: '저녁', name: '저녁운동' }),
    ];

    const { blocks } = buildFilteredRoutineBlocks(records, '2026-03-08', ['점심']);

    // 점심 항목만 포함되어야 함
    const textContent = blocks
      .filter((b) => b.type === 'section')
      .map((b) => ('text' in b ? (b.text as { text: string }).text : ''))
      .join(' ');

    expect(textContent).toContain('점심약');
    expect(textContent).not.toContain('저녁운동');
  });

  it('미완료 이전 시간대 포함', () => {
    const records = [
      makeRecord({ id: 1, time_slot: '아침', completed: false }),
      makeRecord({ id: 2, time_slot: '아침', name: '아침운동', completed: true }),
      makeRecord({ id: 3, time_slot: '점심', name: '점심약' }),
    ];

    const { blocks } = buildFilteredRoutineBlocks(records, '2026-03-08', ['점심'], ['아침']);

    const textContent = blocks
      .filter((b) => b.type === 'section')
      .map((b) => ('text' in b ? (b.text as { text: string }).text : ''))
      .join(' ');

    // 미완료 아침 + 점심 포함, 완료된 아침운동은 제외
    expect(textContent).toContain('운동');
    expect(textContent).toContain('점심약');
    expect(textContent).not.toContain('아침운동');
  });
});

// ─── buildMorningGreetingBlocks ────────────────────────

describe('buildMorningGreetingBlocks', () => {
  it('LLM 생성 텍스트를 블록으로 변환', () => {
    const greeting = '어제 루틴 85%. 잘하고 있어! 밤 루틴만 좀 더 챙기자.';
    const blocks = buildMorningGreetingBlocks(greeting);
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.type).toBe('section');

    const text = (blocks[0] as { text: { text: string } }).text.text;
    expect(text).toBe(greeting);
  });
});

// ─── buildNightSummaryBlocks ───────────────────────────

describe('buildNightSummaryBlocks', () => {
  it('전체 체크리스트 + 마무리 메시지', () => {
    const records = [
      makeRecord({ completed: true }),
      makeRecord({ id: 2, completed: false, name: '독서' }),
    ];

    const summaryText = '오늘도 수고했어! 내일은 독서도 챙기자.';
    const { text, blocks } = buildNightSummaryBlocks(records, '2026-03-08', summaryText);
    expect(text).toContain('1/2');
    // 마무리 메시지 블록이 추가됨
    expect(blocks.length).toBeGreaterThan(3);
  });

  it('전부 완료 시 LLM 마무리 메시지 포함', () => {
    const records = [makeRecord({ completed: true })];

    const summaryText = '오늘 루틴 다 챙겼네! 수고했어, 푹 쉬어.';
    const { blocks } = buildNightSummaryBlocks(records, '2026-03-08', summaryText);
    const lastSection = blocks.filter((b) => b.type === 'section').pop();
    const text =
      lastSection && 'text' in lastSection ? (lastSection.text as { text: string }).text : '';
    expect(text).toContain('수고했어');
  });
});

// ─── buildScheduleBlocks ───────────────────────────────

describe('buildScheduleBlocks', () => {
  it('카테고리별 그룹핑', () => {
    const items = [
      makeSchedule({ id: 1, title: '보고서', category: '업무' }),
      makeSchedule({ id: 2, title: '장보기', category: '생활' }),
    ];

    const { blocks } = buildScheduleBlocks(items, '2026-03-08');
    const textContent = blocks
      .filter((b) => b.type === 'section')
      .map((b) => ('text' in b ? (b.text as { text: string }).text : ''))
      .join(' ');

    expect(textContent).toContain('[업무]');
    expect(textContent).toContain('[생활]');
    expect(textContent).toContain('보고서');
  });

  it('task 항목에 전체 overflow 메뉴 포함', () => {
    const items = [
      makeSchedule({ id: 1, title: '회의', category: '업무' }),
    ];

    const { blocks } = buildScheduleBlocks(items, '2026-03-08');

    const overflowBlocks = blocks.filter((b) => b.type === 'section' && 'accessory' in b);
    expect(overflowBlocks.length).toBe(1);

    if (overflowBlocks[0] && 'accessory' in overflowBlocks[0]) {
      const accessory = overflowBlocks[0].accessory as { action_id: string; options: Array<{ text: { text: string } }> };
      expect(accessory.action_id).toBe(SCHEDULE_ACTION_ID);
      const labels = accessory.options.map((o) => o.text.text);
      expect(labels).toContain('완료');
      expect(labels).toContain('내일로 미루기');
    }
  });

  it('event 타입은 📅 접두어 + 중요/삭제 overflow만', () => {
    const items = [
      makeSchedule({ id: 1, title: '팀 회의', category: '약속', category_type: 'event' }),
    ];

    const { blocks } = buildScheduleBlocks(items, '2026-03-08');

    // 📅 접두어 확인
    const sectionTexts = blocks
      .filter((b) => b.type === 'section')
      .map((b) => ('text' in b ? (b.text as { text: string }).text : ''));
    expect(sectionTexts.some((t) => t.includes('📅 팀 회의'))).toBe(true);

    // overflow에 중요/삭제만 있어야 함
    const overflowBlocks = blocks.filter((b) => b.type === 'section' && 'accessory' in b);
    expect(overflowBlocks.length).toBe(1);
    if (overflowBlocks[0] && 'accessory' in overflowBlocks[0]) {
      const accessory = overflowBlocks[0].accessory as { options: Array<{ text: { text: string } }> };
      const labels = accessory.options.map((o) => o.text.text);
      expect(labels).toEqual(['중요 표시', '삭제하기']);
    }
  });

  it('완료 통계 (event 타입 제외)', () => {
    const items = [
      makeSchedule({ id: 1, status: 'done' }),
      makeSchedule({ id: 2, title: '보고서', status: 'todo' }),
      makeSchedule({ id: 3, title: '점심', category: '약속', category_type: 'event' }),
    ];

    const { blocks } = buildScheduleBlocks(items, '2026-03-08');
    const contextBlock = blocks.find((b) => b.type === 'context');
    expect(contextBlock).toBeDefined();

    if (contextBlock && 'elements' in contextBlock) {
      const text = (contextBlock.elements as Array<{ text: string }>)[0]?.text;
      expect(text).toBe('1/2 완료');
    }
  });

  it('메모가 있어도 표시하지 않음', () => {
    const items = [makeSchedule({ id: 1, title: '회의', memo: '자료 준비 필요' })];

    const { blocks } = buildScheduleBlocks(items, '2026-03-08');

    const contextTexts = blocks
      .filter((b) => b.type === 'context')
      .map((b) => ('elements' in b ? (b.elements as Array<{ text: string }>)[0]?.text : ''))
      .join(' ');
    expect(contextTexts).not.toContain('자료 준비 필요');
  });

  it('compact 모드: overflow 메뉴 없이 렌더링', () => {
    const items = [makeSchedule({ id: 1, title: '회의', category: '업무' })];

    const { blocks } = buildScheduleBlocks(items, '2026-03-08', undefined, { compact: true });

    const overflowBlocks = blocks.filter((b) => b.type === 'section' && 'accessory' in b);
    expect(overflowBlocks).toHaveLength(0);
  });

  it('미분류 카테고리 맨 끝', () => {
    const items = [
      makeSchedule({ id: 1, title: '기타', category: null }),
      makeSchedule({ id: 2, title: '업무', category: '업무' }),
    ];

    const { blocks } = buildScheduleBlocks(items, '2026-03-08');
    const sectionTexts = blocks
      .filter((b) => b.type === 'section')
      .map((b) => ('text' in b ? (b.text as { text: string }).text : ''));

    const 업무Index = sectionTexts.findIndex((t) => t.includes('[업무]'));
    const 미분류Index = sectionTexts.findIndex((t) => t.includes('[미분류]'));
    expect(업무Index).toBeLessThan(미분류Index);
  });
});
