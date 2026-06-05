import { describe, it, expect } from 'vitest';
import {
  buildWindowDates,
  binarizeSqlSeries,
  buildContingency,
  buildDaySequence,
  verifyContingency,
  classifyVerdict,
  statusForVerdict,
  familyOf,
  bhFdrByFamily,
  type DaySeries,
} from '../pattern-verification.js';

// ─── buildWindowDates ────────────────────────────────────

describe('buildWindowDates', () => {
  it('today 포함 [today-cap, today] 오름차순 cap+1개', () => {
    const dates = buildWindowDates('2026-06-05', 3);
    expect(dates).toEqual(['2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05']);
  });
});

// ─── binarizeSqlSeries ───────────────────────────────────

describe('binarizeSqlSeries', () => {
  const dates = ['d0', 'd1', 'd2', 'd3'];

  it('above_abs — v >= threshold', () => {
    const raw = new Map<string, number | null>([
      ['d0', 3],
      ['d1', 1],
      ['d2', 0],
      ['d3', 5],
    ]);
    const s = binarizeSqlSeries(raw, dates, 'above_abs', 2, 28);
    expect(s.get('d0')).toBe(true); // 3>=2
    expect(s.get('d1')).toBe(false); // 1>=2 X
    expect(s.get('d3')).toBe(true); // 5>=2
  });

  it('below_abs — v <= threshold', () => {
    const raw = new Map<string, number | null>([['d0', 0]]);
    const s = binarizeSqlSeries(raw, ['d0'], 'below_abs', 0, 28);
    expect(s.get('d0')).toBe(true); // 0<=0
  });

  it('flag_present — v >= 1 (기본 임계)', () => {
    const raw = new Map<string, number | null>([
      ['d0', 1],
      ['d1', 0],
    ]);
    const s = binarizeSqlSeries(raw, ['d0', 'd1'], 'flag_present', null, 28);
    expect(s.get('d0')).toBe(true);
    expect(s.get('d1')).toBe(false);
  });

  it('above_avg — 워밍업(i<windowDays)은 null, 이후 rolling baseline 비교', () => {
    const raw = new Map<string, number | null>([
      ['d0', 1],
      ['d1', 1],
      ['d2', 10],
      ['d3', 0],
    ]);
    const s = binarizeSqlSeries(raw, dates, 'above_avg', null, 2);
    expect(s.get('d0')).toBeNull(); // 워밍업
    expect(s.get('d1')).toBeNull(); // 워밍업
    expect(s.get('d2')).toBe(true); // baseline mean(1,1)=1, 10>1
    expect(s.get('d3')).toBe(false); // baseline mean(1,10)=5.5, 0>5.5 X
  });

  it('below_avg — baseline 미만이면 true', () => {
    const raw = new Map<string, number | null>([
      ['d0', 1],
      ['d1', 1],
      ['d2', 10],
      ['d3', 0],
    ]);
    const s = binarizeSqlSeries(raw, dates, 'below_avg', null, 2);
    expect(s.get('d2')).toBe(false); // 10<1 X
    expect(s.get('d3')).toBe(true); // 0<5.5
  });

  it('raw가 null(측정불가)이면 null', () => {
    const raw = new Map<string, number | null>([['d0', null]]);
    const s = binarizeSqlSeries(raw, ['d0'], 'above_abs', 1, 28);
    expect(s.get('d0')).toBeNull();
  });
});

// ─── buildContingency ────────────────────────────────────

describe('buildContingency', () => {
  it('발현/비발현 × pass/fail 분류 + 측정불가(null) 발현일은 inconclusive', () => {
    const activation = new Map<string, boolean>([
      ['d0', true],
      ['d1', true],
      ['d2', false],
      ['d3', false],
      ['d4', true],
    ]);
    const signal: DaySeries = new Map([
      ['d0', true], // 발현 & pass → a
      ['d1', false], // 발현 & fail → b
      ['d2', true], // 비발현 & pass → c
      ['d3', false], // 비발현 & fail → d
      ['d4', null], // 발현 & 측정불가 → inconclusive
    ]);
    expect(buildContingency(activation, signal)).toEqual({
      a: 1,
      b: 1,
      c: 1,
      d: 1,
      inconclusive: 1,
    });
  });

  it('신호 시리즈에 없는 날(undefined)은 제외', () => {
    const activation = new Map<string, boolean>([
      ['d0', true],
      ['d9', true],
    ]);
    const signal: DaySeries = new Map([['d0', true]]);
    expect(buildContingency(activation, signal)).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 0,
      inconclusive: 0,
    });
  });
});

// ─── verifyContingency ───────────────────────────────────

describe('verifyContingency', () => {
  it('강한 연관 → 낮은 p, effect > 1, posterior alpha=1+a', () => {
    const v = verifyContingency({ a: 20, b: 2, c: 2, d: 20, inconclusive: 0 });
    expect(v.nActive).toBe(22);
    expect(v.nOff).toBe(22);
    expect(v.effect).toBeGreaterThan(3);
    expect(v.p).toBeLessThan(0.01);
    expect(v.posteriorAlpha).toBe(21); // 1 + a
    expect(v.posteriorBeta).toBe(3); // 1 + b
  });

  it('off일 0이면 effect/p = NaN (대조 불가)', () => {
    const v = verifyContingency({ a: 5, b: 5, c: 0, d: 0, inconclusive: 0 });
    expect(Number.isNaN(v.effect)).toBe(true);
    expect(Number.isNaN(v.p)).toBe(true);
  });

  it('무관(rateActive ≈ rateOff) → effect ≈ 1', () => {
    const v = verifyContingency({ a: 10, b: 10, c: 10, d: 10, inconclusive: 0 });
    expect(v.effect).toBeCloseTo(1, 5);
  });
});

// ─── classifyVerdict ─────────────────────────────────────

describe('classifyVerdict', () => {
  it('nActive ≥ 30 & q ≤ 0.05 & effect ≥ 1.3 → confirm', () => {
    expect(classifyVerdict({ nActive: 40, effect: 2.0 }, 0.01)).toBe('confirm');
  });

  it('nActive ≥ 30 & effect ∈ [0.95, 1.05] → reject', () => {
    expect(classifyVerdict({ nActive: 40, effect: 1.0 }, 0.8)).toBe('reject');
  });

  it('nActive < 30 → insufficient', () => {
    expect(classifyVerdict({ nActive: 10, effect: 2.0 }, 0.01)).toBe('insufficient');
  });

  it('effect NaN(off일 0) → insufficient', () => {
    expect(classifyVerdict({ nActive: 40, effect: NaN }, 0.01)).toBe('insufficient');
  });

  it('데이터 충분하나 effect 모호(1.05~1.3) → inconclusive', () => {
    expect(classifyVerdict({ nActive: 40, effect: 1.2 }, 0.5)).toBe('inconclusive');
  });

  it('effect 충분하나 q 비유의 → inconclusive (confirm 아님)', () => {
    expect(classifyVerdict({ nActive: 40, effect: 2.0 }, 0.5)).toBe('inconclusive');
  });
});

// ─── buildDaySequence ────────────────────────────────────

describe('buildDaySequence', () => {
  it('windowDates 순서로 (active, pass), 측정불가(null)는 제외', () => {
    const activation = new Map<string, boolean>([
      ['d0', true],
      ['d1', false],
      ['d2', true],
      ['d3', true],
    ]);
    const signal: DaySeries = new Map([
      ['d0', true],
      ['d1', false],
      ['d2', null], // 측정불가 → 제외
      ['d3', true],
    ]);
    expect(buildDaySequence(activation, signal, ['d0', 'd1', 'd2', 'd3'])).toEqual([
      { active: true, pass: true },
      { active: false, pass: false },
      { active: true, pass: true },
    ]);
  });

  it('activation 없는 날은 active=false', () => {
    const signal: DaySeries = new Map([['d0', true]]);
    expect(buildDaySequence(new Map(), signal, ['d0'])).toEqual([{ active: false, pass: true }]);
  });
});

// ─── statusForVerdict (P3 e-value 게이트) ────────────────

describe('statusForVerdict', () => {
  it('active + reject → rejected (e 무관, 정당한 제거)', () => {
    expect(statusForVerdict('reject', 'active', 1)).toBe('rejected');
  });

  it('active + confirm & e≥20 → confirmed (verified 승격)', () => {
    expect(statusForVerdict('confirm', 'active', 25)).toBe('confirmed');
  });

  it('active + confirm & e<20 → active (아직 확정 아님, emerging 후보)', () => {
    expect(statusForVerdict('confirm', 'active', 8)).toBe('active');
  });

  it('active + inconclusive/insufficient → active 유지 (e 무관)', () => {
    expect(statusForVerdict('inconclusive', 'active', 50)).toBe('active');
    expect(statusForVerdict('insufficient', 'active', 50)).toBe('active');
  });

  it('non-active(pending/archived/confirmed)는 엔진이 건드리지 않음 (confirmed sticky)', () => {
    expect(statusForVerdict('reject', 'pending', 1)).toBe('pending');
    expect(statusForVerdict('confirm', 'archived', 99)).toBe('archived');
    expect(statusForVerdict('reject', 'confirmed', 1)).toBe('confirmed');
  });
});

// ─── FDR 가족 분리 (#477 P4a, ADR-0037) ──────────────────

describe('familyOf', () => {
  it('strength_band → saju_strength', () => {
    expect(familyOf({ trigger_target_type: 'strength_band' })).toBe('saju_strength');
  });
  it('그 외(life_signal·stem·relation) → baseline', () => {
    expect(familyOf({ trigger_target_type: 'life_signal' })).toBe('baseline');
    expect(familyOf({ trigger_target_type: 'stem' })).toBe('baseline');
  });
});

describe('bhFdrByFamily', () => {
  it('가족 격리 — 강도 시드 추가가 baseline 가족 q를 바꾸지 않음', () => {
    const baselineAlone = bhFdrByFamily([{ p: 0.01, family: 'baseline' }]);
    expect(baselineAlone[0]).toBeCloseTo(0.01, 6); // N=1

    const withStrength = bhFdrByFamily([
      { p: 0.01, family: 'baseline' },
      { p: 0.5, family: 'saju_strength' },
      { p: 0.6, family: 'saju_strength' },
      { p: 0.7, family: 'saju_strength' },
    ]);
    // baseline 가족은 여전히 N=1 → q=0.01 (한 가족이었다면 0.01*4=0.04로 늦춰짐).
    expect(withStrength[0]).toBeCloseTo(0.01, 6);
  });

  it('가족 내부는 함께 BH-FDR 보정 (monotone)', () => {
    const q = bhFdrByFamily([
      { p: 0.01, family: 'baseline' },
      { p: 0.04, family: 'baseline' },
    ]);
    expect(q[0]).toBeCloseTo(0.02, 6); // 0.01*2/1
    expect(q[1]).toBeCloseTo(0.04, 6); // 0.04*2/2
  });

  it('입력 순서·길이 보존 (가족 섞여 있어도 인덱스 유지)', () => {
    const items = [
      { p: 0.5, family: 'saju_strength' as const },
      { p: 0.01, family: 'baseline' as const },
      { p: 0.6, family: 'saju_strength' as const },
    ];
    const q = bhFdrByFamily(items);
    expect(q).toHaveLength(3);
    expect(q[1]).toBeCloseTo(0.01, 6); // baseline 단독 가족
    expect(Number.isFinite(q[0] ?? NaN)).toBe(true);
    expect(Number.isFinite(q[2] ?? NaN)).toBe(true);
  });
});
