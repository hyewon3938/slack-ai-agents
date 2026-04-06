import { describe, it, expect } from 'vitest';
import {
  hexToStyles,
  getCategoryStyle,
  colorToHex,
} from '../types';
import {
  isValidStatus,
  compareByStatus,
} from '@/features/schedule/lib/types';
import type { ScheduleRow } from '@/features/schedule/lib/types';

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
    category: null,
    subcategory: null,
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
