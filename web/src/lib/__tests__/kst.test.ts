import { describe, it, expect } from 'vitest';
import { getTodayISO, formatDateShort, getDayName, addDays } from '../kst';

// ─── getTodayISO ────────────────────────────────────────

describe('getTodayISO', () => {
  it('YYYY-MM-DD 형식을 반환한다', () => {
    const result = getTodayISO();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── formatDateShort ────────────────────────────────────

describe('formatDateShort', () => {
  it('M/D(요일) 형식으로 변환한다', () => {
    expect(formatDateShort('2026-03-08')).toBe('3/8(일)');
  });

  it('토요일을 정확히 표시한다', () => {
    expect(formatDateShort('2026-03-28')).toBe('3/28(토)');
  });

  it('월 경계를 정확히 처리한다', () => {
    expect(formatDateShort('2026-03-31')).toBe('3/31(화)');
    expect(formatDateShort('2026-04-01')).toBe('4/1(수)');
  });

  it('연도 경계를 정확히 처리한다', () => {
    expect(formatDateShort('2025-12-31')).toBe('12/31(수)');
    expect(formatDateShort('2026-01-01')).toBe('1/1(목)');
  });
});

// ─── getDayName ─────────────────────────────────────────

describe('getDayName', () => {
  it('요일 이름을 반환한다', () => {
    expect(getDayName('2026-03-08')).toBe('일');
    expect(getDayName('2026-03-09')).toBe('월');
    expect(getDayName('2026-03-14')).toBe('토');
  });
});

// ─── addDays ────────────────────────────────────────────

describe('addDays', () => {
  it('하루 더하기', () => {
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
  });

  it('하루 빼기', () => {
    expect(addDays('2026-03-08', -1)).toBe('2026-03-07');
  });

  it('월 경계 넘기', () => {
    expect(addDays('2026-03-31', 1)).toBe('2026-04-01');
  });

  it('연도 경계 넘기', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
  });

  it('여러 날 더하기', () => {
    expect(addDays('2026-03-01', 7)).toBe('2026-03-08');
  });

  it('윤년 2월 넘기', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
  });
});
