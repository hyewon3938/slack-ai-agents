import { describe, it, expect } from 'vitest';
import type { RoutineRecord } from '../../../shared/routine-notion.js';
import {
  buildRoutineBlocks,
  buildFilteredRoutineBlocks,
  buildMorningGreetingBlocks,
  buildNightSummaryBlocks,
  formatDateShort,
} from '../blocks.js';

const makeRecord = (
  overrides: Partial<RoutineRecord> = {},
): RoutineRecord => ({
  id: 'page-' + Math.random().toString(36).slice(2, 8),
  title: '테스트 루틴',
  date: '2026-03-06',
  completed: false,
  timeSlot: '아침',
  ...overrides,
});

describe('formatDateShort', () => {
  it('"YYYY-MM-DD"를 "M/D(요일)" 형식으로 변환한다', () => {
    expect(formatDateShort('2026-03-06')).toBe('3/6(금)');
    expect(formatDateShort('2026-03-07')).toBe('3/7(토)');
  });
});

describe('buildRoutineBlocks', () => {
  const today = '2026-03-06';

  it('시간대별로 그룹화하여 블록을 생성한다', () => {
    const records = [
      makeRecord({ title: '루틴A', timeSlot: '아침' }),
      makeRecord({ title: '루틴B', timeSlot: '점심' }),
      makeRecord({ title: '루틴C', timeSlot: '밤' }),
    ];

    const { blocks } = buildRoutineBlocks(records, today);

    const sectionTexts = blocks
      .filter((b) => b.type === 'section')
      .map((b) => ('text' in b && b.text && 'text' in b.text ? b.text.text : ''));

    expect(sectionTexts).toContain('*아침*');
    expect(sectionTexts).toContain('*점심*');
    expect(sectionTexts).toContain('*밤*');
  });

  it('미완료 항목에는 버튼이 포함된다', () => {
    const records = [makeRecord({ title: '루틴A', completed: false })];

    const { blocks } = buildRoutineBlocks(records, today);

    const buttonSection = blocks.find(
      (b) => b.type === 'section' && 'accessory' in b && b.accessory !== undefined,
    );
    expect(buttonSection).toBeDefined();
  });

  it('완료 항목에는 취소선과 체크마크가 표시되고 버튼이 없다', () => {
    const records = [makeRecord({ title: '루틴A', completed: true })];

    const { blocks } = buildRoutineBlocks(records, today);

    const completedSection = blocks.find(
      (b) =>
        b.type === 'section' &&
        'text' in b &&
        b.text &&
        'text' in b.text &&
        b.text.text.includes('~루틴A~'),
    );
    expect(completedSection).toBeDefined();

    if (completedSection && 'accessory' in completedSection) {
      expect(completedSection.accessory).toBeUndefined();
    }
  });

  it('완료 카운트를 올바르게 표시한다', () => {
    const records = [
      makeRecord({ completed: true }),
      makeRecord({ completed: false }),
      makeRecord({ completed: true }),
    ];

    const { text } = buildRoutineBlocks(records, today);

    expect(text).toContain('2/3 완료');
  });

  it('빈 시간대는 건너뛴다', () => {
    const records = [makeRecord({ timeSlot: '아침' })];

    const { blocks } = buildRoutineBlocks(records, today);

    const sectionTexts = blocks
      .filter((b) => b.type === 'section')
      .map((b) => ('text' in b && b.text && 'text' in b.text ? b.text.text : ''));

    expect(sectionTexts).toContain('*아침*');
    expect(sectionTexts).not.toContain('*점심*');
    expect(sectionTexts).not.toContain('*밤*');
  });
});

describe('buildFilteredRoutineBlocks', () => {
  const today = '2026-03-06';

  it('대상 시간대만 포함한다', () => {
    const records = [
      makeRecord({ title: '오전루틴', timeSlot: '아침' }),
      makeRecord({ title: '오후루틴', timeSlot: '점심' }),
    ];

    const { blocks } = buildFilteredRoutineBlocks(records, today, ['점심']);

    const sectionTexts = blocks
      .filter((b) => b.type === 'section')
      .map((b) => ('text' in b && b.text && 'text' in b.text ? b.text.text : ''));

    expect(sectionTexts).toContain('오후루틴');
    expect(sectionTexts).not.toContain('오전루틴');
  });

  it('이전 시간대의 미완료 항목을 포함한다', () => {
    const records = [
      makeRecord({ title: '미완료오전', timeSlot: '아침', completed: false }),
      makeRecord({ title: '완료오전', timeSlot: '아침', completed: true }),
      makeRecord({ title: '오후루틴', timeSlot: '점심' }),
    ];

    const { blocks } = buildFilteredRoutineBlocks(
      records,
      today,
      ['점심'],
      ['아침'],
    );

    const sectionTexts = blocks
      .filter((b) => b.type === 'section')
      .map((b) => ('text' in b && b.text && 'text' in b.text ? b.text.text : ''));

    expect(sectionTexts).toContain('미완료오전');
    expect(sectionTexts).not.toContain('~완료오전~');
    expect(sectionTexts).toContain('오후루틴');
  });
});

describe('buildMorningGreetingBlocks', () => {
  it('어제 기록이 있으면 완료율을 포함한다', () => {
    const records = [
      makeRecord({ completed: true }),
      makeRecord({ completed: true }),
      makeRecord({ completed: false }),
    ];

    const blocks = buildMorningGreetingBlocks(records);
    const text = blocks
      .filter((b) => b.type === 'section')
      .map((b) => ('text' in b && b.text && 'text' in b.text ? b.text.text : ''))
      .join('');

    expect(text).toContain('달성 67%');
    expect(text).toContain('좋은 아침');
  });

  it('전부 완료 시 축하 메시지를 포함한다', () => {
    const records = [
      makeRecord({ completed: true }),
      makeRecord({ completed: true }),
    ];

    const blocks = buildMorningGreetingBlocks(records);
    const text = blocks
      .filter((b) => b.type === 'section')
      .map((b) => ('text' in b && b.text && 'text' in b.text ? b.text.text : ''))
      .join('');

    expect(text).toContain('달성 100%');
    expect(text).toContain('대단해');
  });

  it('어제 기록이 없으면 기본 인사를 반환한다', () => {
    const blocks = buildMorningGreetingBlocks([]);
    const text = blocks
      .filter((b) => b.type === 'section')
      .map((b) => ('text' in b && b.text && 'text' in b.text ? b.text.text : ''))
      .join('');

    expect(text).toContain('좋은 아침');
  });
});

describe('buildNightSummaryBlocks', () => {
  const today = '2026-03-06';

  it('전부 완료 시 축하 메시지를 포함한다', () => {
    const records = [
      makeRecord({ completed: true }),
      makeRecord({ completed: true, timeSlot: '점심' }),
    ];

    const { blocks } = buildNightSummaryBlocks(records, today);

    const summaryBlock = blocks.find(
      (b) =>
        b.type === 'section' &&
        'text' in b &&
        b.text &&
        'text' in b.text &&
        b.text.text.includes('전부 완료'),
    );
    expect(summaryBlock).toBeDefined();
  });

  it('미완료 시 격려 메시지를 포함한다', () => {
    const records = [
      makeRecord({ completed: true }),
      makeRecord({ completed: false, timeSlot: '점심' }),
    ];

    const { blocks } = buildNightSummaryBlocks(records, today);

    const summaryBlock = blocks.find(
      (b) =>
        b.type === 'section' &&
        'text' in b &&
        b.text &&
        'text' in b.text &&
        b.text.text.includes('1/2 완료'),
    );
    expect(summaryBlock).toBeDefined();
  });
});
