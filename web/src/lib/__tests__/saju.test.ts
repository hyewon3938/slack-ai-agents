import { describe, expect, it } from 'vitest';
import { getDayPillar } from '../saju';

describe('getDayPillar', () => {
  it('기준일 2024-02-04 → 戊戌 (index 34)', () => {
    const p = getDayPillar('2024-02-04');
    expect(p.index).toBe(34);
    expect(p.hanja).toBe('戊戌');
    expect(p.hangul).toBe('무술');
    expect(p.cheongan).toBe('무');
    expect(p.jiji).toBe('술');
  });

  it('ADR 검증 케이스 2026-03-14 → 丁亥 (index 23)', () => {
    const p = getDayPillar('2026-03-14');
    expect(p.index).toBe(23);
    expect(p.hanja).toBe('丁亥');
    expect(p.hangul).toBe('정해');
  });

  it('사용자 예시 2026-05-26 → 庚子 (경자)', () => {
    const p = getDayPillar('2026-05-26');
    expect(p.hanja).toBe('庚子');
    expect(p.hangul).toBe('경자');
    expect(p.cheongan).toBe('경');
    expect(p.jiji).toBe('자');
  });

  it('기준일 다음날 2024-02-05 → 己亥 (index 35)', () => {
    const p = getDayPillar('2024-02-05');
    expect(p.index).toBe(35);
    expect(p.hanja).toBe('己亥');
  });

  it('기준일 전날 2024-02-03 → 丁酉 (index 33)', () => {
    const p = getDayPillar('2024-02-03');
    expect(p.index).toBe(33);
    expect(p.hanja).toBe('丁酉');
  });
});
