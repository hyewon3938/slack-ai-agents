import { describe, it, expect } from 'vitest';
import { hexToStyles, getCategoryStyle, colorToHex } from '../types';
import { isValidStatus, compareByStatus } from '@/features/schedule/lib/types';
import {
  compareSchedulePriority,
  lookupCategory,
  isMultiDaySchedule,
} from '@/features/schedule/lib/types';
import type { ScheduleRow } from '@/features/schedule/lib/types';
import type { CategoryRow } from '../types';

// ─── isValidStatus ──────────────────────────────────────

describe('isValidStatus', () => {
  it('유효한 상태값을 통과시킨다', () => {
    expect(isValidStatus('todo')).toBe(true);
    expect(isValidStatus('in-progress')).toBe(true);
    expect(isValidStatus('done')).toBe(true);
    expect(isValidStatus('cancelled')).toBe(true);
  });

  it('잘못된 상태값을 거부한다', () => {
    expect(isValidStatus('invalid')).toBe(false);
    expect(isValidStatus('')).toBe(false);
    expect(isValidStatus(null)).toBe(false);
    expect(isValidStatus(undefined)).toBe(false);
    expect(isValidStatus(123)).toBe(false);
  });
});

// ─── compareByStatus ────────────────────────────────────

describe('compareByStatus', () => {
  const make = (status: string): ScheduleRow => ({
    id: 1,
    title: 'test',
    date: '2026-03-01',
    end_date: null,
    status,
    category_id: null,
    memo: null,
    important: false,
  });

  it('진행중 → 할일 → 완료 → 취소 순으로 정렬한다', () => {
    const items = [make('done'), make('todo'), make('cancelled'), make('in-progress')];
    items.sort(compareByStatus);
    expect(items.map((i) => i.status)).toEqual(['in-progress', 'todo', 'done', 'cancelled']);
  });

  it('같은 상태끼리는 순서를 유지한다', () => {
    const a = { ...make('todo'), id: 1 };
    const b = { ...make('todo'), id: 2 };
    expect(compareByStatus(a, b)).toBe(0);
  });
});

// ─── hexToStyles ────────────────────────────────────────

describe('hexToStyles', () => {
  it('밝은 색상에는 어두운 텍스트를 반환한다', () => {
    const result = hexToStyles('#ffffff');
    expect(result.text).toBe('#1f2937');
  });

  it('어두운 색상에는 흰색 텍스트를 반환한다', () => {
    const result = hexToStyles('#000000');
    expect(result.text).toBe('#ffffff');
  });

  it('rgba 배경색을 생성한다', () => {
    const result = hexToStyles('#ff0000');
    expect(result.bg).toBe('rgba(255, 0, 0, 0.85)');
    expect(result.border).toBe('rgba(255, 0, 0, 1)');
  });
});

// ─── getCategoryStyle ───────────────────────────────────

describe('getCategoryStyle', () => {
  it('프리셋 색상에서 인라인 스타일을 반환한다', () => {
    const result = getCategoryStyle('violet');
    expect(result.bg).toContain('rgba(');
    expect(result.text).toBeDefined();
    expect(result.border).toBeDefined();
  });

  it('hex 색상에서 인라인 스타일을 반환한다', () => {
    const result = getCategoryStyle('#ff5733');
    expect(result.bg).toContain('rgba(');
    expect(result.text).toBeDefined();
  });

  it('알 수 없는 색상은 gray hex로 폴백한다', () => {
    const result = getCategoryStyle('unknown');
    expect(result.bg).toContain('rgba(107');
  });
});

// ─── colorToHex ─────────────────────────────────────────

describe('colorToHex', () => {
  it('프리셋 이름을 hex로 변환한다', () => {
    expect(colorToHex('violet')).toBe('#ddd6fe');
    expect(colorToHex('amber')).toBe('#fde68a');
  });

  it('hex 값은 그대로 반환한다', () => {
    expect(colorToHex('#ff5733')).toBe('#ff5733');
  });

  it('알 수 없는 값은 gray hex로 폴백한다', () => {
    expect(colorToHex('unknown')).toBe('#6b7280');
  });
});

// ─── 일정 우선순위 (schedule/lib/types) ─────────────────

// 합성 픽스처 (실제 개인 데이터 아님)
const CATEGORIES: CategoryRow[] = [
  { id: 1, name: '약속', color: 'violet', type: 'event', sort_order: 2, parent_id: null },
  { id: 2, name: '업무', color: 'amber', type: 'task', sort_order: 1, parent_id: null },
  { id: 3, name: '개인', color: 'gray', type: 'task', sort_order: 3, parent_id: null },
  // 자식: 순서는 부모를 따르고 자기 sort_order(0)는 쓰지 않는다
  { id: 31, name: '운동', color: 'gray', type: 'task', sort_order: 0, parent_id: 3 },
];

const schedule = (overrides: Partial<ScheduleRow> = {}): ScheduleRow => ({
  id: 1,
  title: 'test',
  date: '2026-03-01',
  end_date: null,
  status: 'todo',
  category_id: null,
  memo: null,
  important: false,
  ...overrides,
});

describe('isMultiDaySchedule', () => {
  it('end_date가 date와 다르면 기간 일정이다', () => {
    expect(isMultiDaySchedule(schedule({ end_date: '2026-03-03' }))).toBe(true);
  });

  it('end_date가 없거나 date와 같으면 단일 일정이다', () => {
    expect(isMultiDaySchedule(schedule({ end_date: null }))).toBe(false);
    expect(isMultiDaySchedule(schedule({ end_date: '2026-03-01' }))).toBe(false);
  });
});

describe('lookupCategory', () => {
  it('category_id가 null이거나 목록에 없으면 전부 null', () => {
    const none = { type: null, sortOrder: null, topId: null, topName: null };
    expect(lookupCategory(CATEGORIES, null)).toEqual(none);
    expect(lookupCategory(CATEGORIES, 999)).toEqual(none);
  });

  it('자식 카테고리는 최상위의 sort_order·id·이름을 돌려준다', () => {
    expect(lookupCategory(CATEGORIES, 31)).toEqual({
      type: 'task',
      sortOrder: 3,
      topId: 3,
      topName: '개인',
    });
  });

  it('자식 type이 비어 있으면 부모 type을 상속한다', () => {
    // 하위 카테고리는 type이 NULL이면 상위를 따른다
    const child: CategoryRow = {
      id: 11,
      name: '저녁 약속',
      color: 'gray',
      type: null,
      sort_order: 0,
      parent_id: 1,
    };
    expect(lookupCategory([...CATEGORIES, child], 11).type).toBe('event');
  });

  it('parent_id가 가리키는 부모가 없으면 자기 자신을 최상위로 쓴다', () => {
    const orphan: CategoryRow = {
      id: 50,
      name: '고아',
      color: 'gray',
      type: 'task',
      sort_order: 7,
      parent_id: 404,
    };
    expect(lookupCategory([...CATEGORIES, orphan], 50)).toEqual({
      type: 'task',
      sortOrder: 7,
      topId: 50,
      topName: '고아',
    });
  });
});

describe('compareSchedulePriority', () => {
  const sortIds = (items: ScheduleRow[]): number[] =>
    [...items].sort((a, b) => compareSchedulePriority(a, b, CATEGORIES)).map((s) => s.id);

  it('event 타입 일정은 중요한 기간 일정보다도 위에 온다', () => {
    const event = schedule({ id: 1, category_id: 1 });
    const multiImportant = schedule({ id: 2, end_date: '2026-03-05', important: true });
    expect(sortIds([multiImportant, event])).toEqual([1, 2]);
  });

  it('기간 일정은 중요한 단일 일정보다 앞이고, end_date === date는 단일로 본다', () => {
    const single = schedule({ id: 1, important: true });
    const sameDay = schedule({ id: 2, end_date: '2026-03-01', important: true });
    const multi = schedule({ id: 3, end_date: '2026-03-02' });
    expect(sortIds([single, sameDay, multi])).toEqual([3, 1, 2]);
  });

  it('활성(할일·진행중)은 중요한 완료·취소 일정보다 앞이다', () => {
    const doneImportant = schedule({ id: 1, status: 'done', important: true });
    const cancelled = schedule({ id: 2, status: 'cancelled', important: true });
    const todo = schedule({ id: 3, status: 'todo' });
    expect(sortIds([doneImportant, cancelled, todo])).toEqual([3, 1, 2]);
  });

  it('같은 활성 그룹에서는 중요한 할일이 진행중보다 앞이다', () => {
    const inProgress = schedule({ id: 1, status: 'in-progress' });
    const importantTodo = schedule({ id: 2, status: 'todo', important: true });
    expect(sortIds([inProgress, importantTodo])).toEqual([2, 1]);
  });

  it('나머지가 같으면 최상위 카테고리 sort_order 순이고 카테고리 없는 일정은 맨 뒤', () => {
    const noCategory = schedule({ id: 1 });
    const personalChild = schedule({ id: 2, category_id: 31 }); // 부모 sort_order 3
    const work = schedule({ id: 3, category_id: 2 }); // sort_order 1
    expect(sortIds([noCategory, personalChild, work])).toEqual([3, 2, 1]);
  });
});
