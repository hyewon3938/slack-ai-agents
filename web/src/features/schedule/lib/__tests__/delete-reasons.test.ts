import { describe, it, expect } from 'vitest';
import { DELETE_REASONS, isDeleteReasonCategory } from '../delete-reasons';

describe('DELETE_REASONS', () => {
  it('고정 어휘 5종 — 마이그레이션 106 CHECK 제약과 동기', () => {
    expect(DELETE_REASONS.map((r) => r.value)).toEqual([
      'mistake',
      'changed_mind',
      'external',
      'rescheduled',
      'other',
    ]);
  });

  it('value 중복 없음', () => {
    const values = DELETE_REASONS.map((r) => r.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('모든 항목에 한국어 라벨 존재', () => {
    for (const r of DELETE_REASONS) {
      expect(r.label.length).toBeGreaterThan(0);
    }
  });
});

describe('isDeleteReasonCategory', () => {
  it('유효한 카테고리 코드 통과', () => {
    expect(isDeleteReasonCategory('mistake')).toBe(true);
    expect(isDeleteReasonCategory('changed_mind')).toBe(true);
    expect(isDeleteReasonCategory('other')).toBe(true);
  });

  it('어휘 밖 값 거부', () => {
    expect(isDeleteReasonCategory('bogus')).toBe(false);
    expect(isDeleteReasonCategory('')).toBe(false);
    expect(isDeleteReasonCategory('MISTAKE')).toBe(false);
  });

  it('문자열 아닌 값 거부', () => {
    expect(isDeleteReasonCategory(null)).toBe(false);
    expect(isDeleteReasonCategory(undefined)).toBe(false);
    expect(isDeleteReasonCategory(1)).toBe(false);
    expect(isDeleteReasonCategory({ value: 'mistake' })).toBe(false);
  });
});
