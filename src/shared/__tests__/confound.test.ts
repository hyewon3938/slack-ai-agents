import { describe, it, expect } from 'vitest';
import {
  computeOverlap,
  flagConfoundersForLink,
  type ConfoundCandidate,
  type ConfoundThresholds,
} from '../confound.js';
import type { DaySeries } from '../pattern-verification.js';

// 합성 시리즈 헬퍼 — 10일 윈도우(d0..d9). buildContingency/verifyContingency는 이미 검증됨(pattern-verification.test) →
// 여기선 교란 조립 로직(2조건 AND·정렬·topN·자기 제외)에 집중.
const DAYS = Array.from({ length: 10 }, (_, i) => `d${i}`);

const act = (activeDates: string[]): Map<string, boolean> => {
  const s = new Set(activeDates);
  return new Map(DAYS.map((d) => [d, s.has(d)]));
};

const sig = (passDates: string[]): DaySeries => {
  const p = new Set(passDates);
  return new Map(DAYS.map((d) => [d, p.has(d)]));
};

const T: ConfoundThresholds = { minOverlap: 0.6, minCofireDays: 3, minEffectZX: 1.3, topN: 3 };

// 링크 시드 S 활성 = d0..d4, 신호 X = S 발현일에 pass(둘이 정렬).
const S_ACTIVE = ['d0', 'd1', 'd2', 'd3', 'd4'];
const actS = act(S_ACTIVE);
const SIG = sig(['d0', 'd1', 'd2', 'd3', 'd4']);

// ─── computeOverlap ──────────────────────────────────────

describe('computeOverlap', () => {
  it('S 발현일 대비 Z 공동발현 비율 + cofire 수', () => {
    const r = computeOverlap(act(['d0', 'd1', 'd2', 'd3']), act(['d0', 'd1', 'd8']));
    expect(r.nCofire).toBe(2); // {d0, d1}
    expect(r.overlap).toBeCloseTo(0.5); // 2/4
  });

  it('S 발현 0이면 {0, 0}', () => {
    expect(computeOverlap(act([]), act(['d0', 'd1']))).toEqual({ overlap: 0, nCofire: 0 });
  });
});

// ─── flagConfoundersForLink ──────────────────────────────

describe('flagConfoundersForLink', () => {
  // overlap 0.8(4/5) + 신호와 강하게 연관 → flagged.
  const conf: ConfoundCandidate = {
    seedId: 2,
    seedName: '주말',
    act: act(['d0', 'd1', 'd2', 'd3']),
  };
  // S와 거의 안 겹침(cofire 1) → overlap·cofire 게이트 컷.
  const lowOverlap: ConfoundCandidate = {
    seedId: 3,
    seedName: '저겹침',
    act: act(['d0', 'd5', 'd6', 'd7']),
  };
  // overlap 0.6 통과하나 신호와 무관(pass/fail 균등) → effectZX 게이트 컷(조건 b 필수).
  const noAssoc: ConfoundCandidate = {
    seedId: 4,
    seedName: '무관',
    act: act(['d0', 'd1', 'd2', 'd5', 'd6', 'd7']),
  };

  it('overlap + effectZX 둘 다 통과 → flagged', () => {
    const r = flagConfoundersForLink(1, actS, SIG, [conf], 'today', T);
    expect(r.suspected).toHaveLength(1);
    expect(r.suspected[0]?.seedId).toBe(2);
    expect(r.suspected[0]?.overlap).toBeCloseTo(0.8);
    expect(r.suspected[0]?.nCofire).toBe(4);
    expect(r.suspected[0]?.effectZX).toBeGreaterThanOrEqual(1.3);
  });

  it('overlap 통과 + effectZX 미달(신호와 무관) → 미flag (조건 b 필수)', () => {
    const r = flagConfoundersForLink(1, actS, SIG, [noAssoc], 'today', T);
    expect(r.suspected).toHaveLength(0);
  });

  it('overlap 미달 → 미flag', () => {
    const r = flagConfoundersForLink(1, actS, SIG, [lowOverlap], 'today', T);
    expect(r.suspected).toHaveLength(0);
  });

  it('nCofire < minCofireDays → 미flag (노이즈 바닥)', () => {
    // conf는 nCofire=4. 바닥을 5로 올리면 overlap·effect 통과해도 cofire 게이트가 컷.
    const r = flagConfoundersForLink(1, actS, SIG, [conf], 'today', { ...T, minCofireDays: 5 });
    expect(r.suspected).toHaveLength(0);
  });

  it('Z == S 자기 제외', () => {
    const selfCand: ConfoundCandidate = {
      seedId: 1, // = 링크 시드 S
      seedName: 'self',
      act: act(['d0', 'd1', 'd2', 'd3']), // 통계상 flag감이나 자기 제외로 빠짐
    };
    const r = flagConfoundersForLink(1, actS, SIG, [selfCand, conf], 'today', T);
    expect(r.suspected.map((s) => s.seedId)).not.toContain(1);
    expect(r.suspected.map((s) => s.seedId)).toContain(2);
  });

  it('overlap 내림차순 정렬 + topN cap', () => {
    // 신호 X는 pass 폭을 넓혀(d0..d6) 세 후보 모두 effectZX 통과·유한.
    const sigWide = sig(['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6']);
    const c1: ConfoundCandidate = {
      seedId: 11,
      seedName: 'a',
      act: act(['d0', 'd1', 'd2', 'd3', 'd4']),
    }; // 1.0
    const c2: ConfoundCandidate = { seedId: 12, seedName: 'b', act: act(['d0', 'd1', 'd2', 'd3']) }; // 0.8
    const c3: ConfoundCandidate = { seedId: 13, seedName: 'c', act: act(['d0', 'd1', 'd2']) }; // 0.6
    const r = flagConfoundersForLink(1, actS, sigWide, [c3, c1, c2], 'today', { ...T, topN: 2 });
    expect(r.suspected).toHaveLength(2);
    expect(r.suspected.map((s) => s.seedId)).toEqual([11, 12]); // overlap 내림차순, topN=2
  });

  it('의심 없어도 scannedAt 기록(점검함 vs 미점검 구분)', () => {
    const r = flagConfoundersForLink(1, actS, SIG, [lowOverlap], 'today', T);
    expect(r.suspected).toHaveLength(0);
    expect(r.scannedAt).toBe('today');
  });
});
