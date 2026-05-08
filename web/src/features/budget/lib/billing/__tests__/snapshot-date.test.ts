import { describe, expect, it } from 'vitest';
import { resolvePreviousDayDate } from '../snapshot-date';

// cron 예약: 20:00 UTC (KST 05:00, 익일)
// 전일 기준: KST 05:00 - 24h = 전날 KST 05:00 → 전일 날짜 반환

describe('resolvePreviousDayDate', () => {
  it('정시 발화(KST 05:00) — 전일 KST 날짜 반환', () => {
    // 2026-04-15 20:00 UTC = KST 2026-04-16 05:00 → 전일 = 2026-04-15
    const utc = new Date('2026-04-15T20:00:00Z');
    expect(resolvePreviousDayDate(utc)).toBe('2026-04-15');
  });

  it('30분 드리프트 — 전일 유지', () => {
    // 2026-04-15 20:30 UTC = KST 2026-04-16 05:30 → 전일 = 2026-04-15
    const utc = new Date('2026-04-15T20:30:00Z');
    expect(resolvePreviousDayDate(utc)).toBe('2026-04-15');
  });

  it('수 시간 드리프트 — KST 날짜가 같은 한 전일 유지', () => {
    // 2026-04-15 23:59 UTC = KST 2026-04-16 08:59 → 전일 = 2026-04-15
    const utc = new Date('2026-04-15T23:59:00Z');
    expect(resolvePreviousDayDate(utc)).toBe('2026-04-15');
  });

  it('발화 시각이 KST 다음날로 넘어가면 그날의 전일 반환', () => {
    // 2026-04-16 00:00 UTC = KST 2026-04-16 09:00 → 전일 = 2026-04-15
    const utc = new Date('2026-04-16T00:00:00Z');
    expect(resolvePreviousDayDate(utc)).toBe('2026-04-15');
  });

  it('월말 경계 — 4월 30일 발화 시 전일은 4월 30일 (당해)', () => {
    // 2026-04-30 20:00 UTC = KST 2026-05-01 05:00 → 전일 = 2026-04-30
    const utc = new Date('2026-04-30T20:00:00Z');
    expect(resolvePreviousDayDate(utc)).toBe('2026-04-30');
  });

  it('월 초 경계 — 5월 1일 발화 시 전일은 5월 1일 (당해)', () => {
    // 2026-05-01 20:00 UTC = KST 2026-05-02 05:00 → 전일 = 2026-05-01
    const utc = new Date('2026-05-01T20:00:00Z');
    expect(resolvePreviousDayDate(utc)).toBe('2026-05-01');
  });

  it('연말 경계 — 12월 31일 발화 시 전일은 12월 31일 (당해)', () => {
    // 2026-12-31 20:00 UTC = KST 2027-01-01 05:00 → 전일 = 2026-12-31
    const utc = new Date('2026-12-31T20:00:00Z');
    expect(resolvePreviousDayDate(utc)).toBe('2026-12-31');
  });

  it('윤년 2월 29일 — 정상 처리', () => {
    // 2028-02-29 20:00 UTC = KST 2028-03-01 05:00 → 전일 = 2028-02-29
    const utc = new Date('2028-02-29T20:00:00Z');
    expect(resolvePreviousDayDate(utc)).toBe('2028-02-29');
  });
});
