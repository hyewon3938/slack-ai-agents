import { describe, it, expect } from 'vitest';
import {
  getTodayISO,
  getYesterdayISO,
  getTodayString,
  getKSTTimeString,
  formatDateShort,
  addDays,
} from '../kst.js';

// ─── getTodayISO ────────────────────────────────────────

describe('getTodayISO', () => {
  it('YYYY-MM-DD 형식을 반환한다', () => {
    const result = getTodayISO();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── getYesterdayISO ────────────────────────────────────

describe('getYesterdayISO', () => {
  it('YYYY-MM-DD 형식을 반환한다', () => {
    const result = getYesterdayISO();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('오늘보다 하루 이전이다', () => {
    const today = new Date(getTodayISO() + 'T12:00:00+09:00');
    const yesterday = new Date(getYesterdayISO() + 'T12:00:00+09:00');
    const diffMs = today.getTime() - yesterday.getTime();
    expect(diffMs).toBe(86_400_000);
  });
});

// ─── getTodayString ─────────────────────────────────────

describe('getTodayString', () => {
  it('YYYY-MM-DD (요일) 형식을 반환한다', () => {
    const result = getTodayString();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \([일월화수목금토]\)$/);
  });
});

// ─── getKSTTimeString ───────────────────────────────────

describe('getKSTTimeString', () => {
  it('HH:MM 형식을 반환한다', () => {
    const result = getKSTTimeString();
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });
});

// ─── formatDateShort ────────────────────────────────────

describe('formatDateShort', () => {
  it('YYYY-MM-DD → M/D(요일) 형식', () => {
    const result = formatDateShort('2026-03-08');
    expect(result).toBe('3/8(일)');
  });

  it('3월 28일은 토요일', () => {
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
});
