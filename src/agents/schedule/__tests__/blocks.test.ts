import { describe, it, expect } from 'vitest';
import type { ScheduleItem } from '../../../shared/notion.js';
import {
  encodeOverflowValue,
  parseOverflowValue,
  POSTPONE_ACTION,
  buildScheduleBlocks,
} from '../blocks.js';

const createItem = (overrides: Partial<ScheduleItem> = {}): ScheduleItem => ({
  id: 'page-1',
  title: '회의',
  date: { start: '2026-03-07', end: null },
  status: 'todo',
  category: [],
  hasStarIcon: false,
  ...overrides,
});

describe('encodeOverflowValue / parseOverflowValue', () => {
  it('인코딩과 파싱이 대칭이다', () => {
    const encoded = encodeOverflowValue('p1', 'done', '2026-03-07');
    expect(encoded).toBe('p1|done|2026-03-07');
    const parsed = parseOverflowValue(encoded);
    expect(parsed).toEqual({
      pageId: 'p1',
      newStatus: 'done',
      targetDate: '2026-03-07',
    });
  });

  it('postpone 액션도 인코딩/파싱된다', () => {
    const encoded = encodeOverflowValue('p2', POSTPONE_ACTION, '2026-03-07');
    const parsed = parseOverflowValue(encoded);
    expect(parsed.newStatus).toBe('postpone');
  });
});

describe('buildScheduleBlocks', () => {
  it('할일 항목에 overflow 메뉴가 포함된다', () => {
    const items = [createItem({ status: 'todo' })];
    const { blocks } = buildScheduleBlocks(items, '2026-03-07');

    const sectionWithAccessory = blocks.find(
      (b) => b.type === 'section' && 'accessory' in b,
    );
    expect(sectionWithAccessory).toBeDefined();
  });

  it('약속 항목에는 overflow 메뉴가 없다', () => {
    const items = [createItem({ category: ['약속'] })];
    const { blocks } = buildScheduleBlocks(items, '2026-03-07');

    const sectionWithAccessory = blocks.find(
      (b) => b.type === 'section' && 'accessory' in b,
    );
    expect(sectionWithAccessory).toBeUndefined();
  });

  it('todo 항목에 "내일로 미루기" 옵션이 포함된다', () => {
    const items = [createItem({ status: 'todo' })];
    const { blocks } = buildScheduleBlocks(items, '2026-03-07');

    const sectionWithAccessory = blocks.find(
      (b) => b.type === 'section' && 'accessory' in b,
    ) as { accessory?: { options?: Array<{ text: { text: string }; value: string }> } } | undefined;

    const options = sectionWithAccessory?.accessory?.options ?? [];
    const postponeOption = options.find((opt) => opt.value.includes(POSTPONE_ACTION));
    expect(postponeOption).toBeDefined();
    expect(postponeOption?.text.text).toBe('내일로 미루기');
  });

  it('done 항목에는 "내일로 미루기" 옵션이 없다', () => {
    const items = [createItem({ status: 'done' })];
    const { blocks } = buildScheduleBlocks(items, '2026-03-07');

    const sectionWithAccessory = blocks.find(
      (b) => b.type === 'section' && 'accessory' in b,
    ) as { accessory?: { options?: Array<{ text: { text: string }; value: string }> } } | undefined;

    const options = sectionWithAccessory?.accessory?.options ?? [];
    const postponeOption = options.find((opt) => opt.value.includes(POSTPONE_ACTION));
    expect(postponeOption).toBeUndefined();
  });

  it('in-progress 항목에 "내일로 미루기" 옵션이 포함된다', () => {
    const items = [createItem({ status: 'in-progress' })];
    const { blocks } = buildScheduleBlocks(items, '2026-03-07');

    const sectionWithAccessory = blocks.find(
      (b) => b.type === 'section' && 'accessory' in b,
    ) as { accessory?: { options?: Array<{ text: { text: string }; value: string }> } } | undefined;

    const options = sectionWithAccessory?.accessory?.options ?? [];
    const postponeOption = options.find((opt) => opt.value.includes(POSTPONE_ACTION));
    expect(postponeOption).toBeDefined();
  });

  it('하단 통계에 완료 카운트가 표시된다', () => {
    const items = [
      createItem({ id: 'p1', status: 'done' }),
      createItem({ id: 'p2', status: 'todo' }),
    ];
    const { blocks } = buildScheduleBlocks(items, '2026-03-07');

    const context = blocks.find((b) => b.type === 'context') as {
      elements?: Array<{ text: string }>;
    } | undefined;
    expect(context?.elements?.[0]?.text).toContain('1/2 완료');
  });
});
