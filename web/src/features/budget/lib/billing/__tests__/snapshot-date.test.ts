import { describe, expect, it } from 'vitest';
import { resolveSnapshotDate } from '../snapshot-date';

// cron 예약: 14:50 UTC (KST 23:50)
// 버퍼 차감 후: 13:50 UTC (KST 22:50) → 당일

describe('resolveSnapshotDate', () => {
  it('정시 발화 — 당일 KST 날짜 반환', () => {
    // 14:50 UTC → 13:50 UTC → KST 22:50 → 2026-04-15
    const utc = new Date('2026-04-15T14:50:00Z');
    expect(resolveSnapshotDate(utc)).toBe('2026-04-15');
  });

  it('30분 드리프트 — 당일 KST 날짜 유지', () => {
    // 15:20 UTC → 14:20 UTC → KST 23:20 → 2026-04-15
    const utc = new Date('2026-04-15T15:20:00Z');
    expect(resolveSnapshotDate(utc)).toBe('2026-04-15');
  });

  it('1시간 드리프트 — 당일 KST 날짜 유지', () => {
    // 15:50 UTC → 14:50 UTC → KST 23:50 → 2026-04-15
    const utc = new Date('2026-04-15T15:50:00Z');
    expect(resolveSnapshotDate(utc)).toBe('2026-04-15');
  });

  it('1시간 초과 드리프트 — 다음날로 넘어감 (버퍼 한계)', () => {
    // 16:10 UTC → 15:10 UTC → KST 00:10 → 2026-04-16
    const utc = new Date('2026-04-15T16:10:00Z');
    expect(resolveSnapshotDate(utc)).toBe('2026-04-16');
  });

  it('KST 자정 직전 — 당일 유지', () => {
    // 14:59:59 UTC → 13:59:59 UTC → KST 22:59:59 → 2026-04-15
    const utc = new Date('2026-04-15T14:59:59Z');
    expect(resolveSnapshotDate(utc)).toBe('2026-04-15');
  });

  it('월말 경계 — 올바른 날짜 반환', () => {
    // 2026-04-30 15:00 UTC → 14:00 UTC → KST 23:00 → 2026-04-30
    const utc = new Date('2026-04-30T15:00:00Z');
    expect(resolveSnapshotDate(utc)).toBe('2026-04-30');
  });

  it('커스텀 버퍼 적용', () => {
    // 버퍼 30분: 2026-04-15T15:00Z → 14:30Z → KST 23:30 → 2026-04-15
    const utc = new Date('2026-04-15T15:00:00Z');
    expect(resolveSnapshotDate(utc, 30 * 60 * 1000)).toBe('2026-04-15');
  });
});
