import { describe, it, expect } from 'vitest';
import {
  computeOverlap,
  flagConfoundersForLink,
  adjustConfounders,
  classifyVerdict,
  buildStrata,
  type ConfoundCandidate,
  type ConfoundThresholds,
  type ConfoundAdjustThresholds,
  type SuspectedConfounder,
} from '../confound.js';
import { buildContingency, type DaySeries } from '../pattern-verification.js';

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

  it('windowStart 이전 날은 분자·분모 양쪽에서 제외 (#556 데이터-존재 클립)', () => {
    // S={d0..d3}, Z={d0,d1,d8}. windowStart='d1' → d0 제외 → S발현 {d1,d2,d3}=3, cofire {d1}=1.
    const r = computeOverlap(act(['d0', 'd1', 'd2', 'd3']), act(['d0', 'd1', 'd8']), 'd1');
    expect(r.nCofire).toBe(1); // {d1} (d0 클립)
    expect(r.overlap).toBeCloseTo(1 / 3); // 1/3 (분모도 d0 제외)
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

// ─── #556 데이터-존재 윈도우 클립 (검증 엔진 #504 ADR-0044와 동일) ────

describe('flagConfoundersForLink 데이터-존재 클립', () => {
  // 데이터 시작 이전(d0..d3)은 '빈 과거' — S·Z 비활성, X 비pass(fail)로만 채워져 Z↔X 2×2의
  // 비발현·실패(d 셀)를 부풀린다 → rateOff 하락 → effectZX 인플레(가짜 교란 flag).
  // 클립 후엔 데이터 구간(d4..d9)만으로 effectZX가 정직하게 낮아진다.
  const S = act(['d4', 'd5', 'd6']); // S 발현 = 데이터 구간에만
  const Z: ConfoundCandidate = { seedId: 9, seedName: 'Z', act: act(['d4', 'd5', 'd6', 'd7']) };
  // X: Z 발현일 d4·d5·d6 pass, off일 중 d8만 pass(rateOff 유한하게). d0..d3(빈 과거)는 fail.
  const X = sig(['d4', 'd5', 'd6', 'd8']);
  // minEffectZX를 두 값 사이(2.0)로 → 클립 유무가 flag 판정을 뒤집는다.
  const Tclip: ConfoundThresholds = {
    minOverlap: 0.6,
    minCofireDays: 3,
    minEffectZX: 2.0,
    topN: 3,
  };

  it('클립 없으면 빈 과거가 effectZX를 부풀려 flag(비교 기준)', () => {
    // no clip: Z발현 a=3,b=1(d7 fail); Z off c=1(d8),d=5(d0..d3+d9) → rateOff=1/6 → effect≈4.5 ≥ 2.0.
    const r = flagConfoundersForLink(1, S, X, [Z], 'today', Tclip);
    expect(r.suspected).toHaveLength(1);
    expect(r.suspected[0]?.effectZX).toBeCloseTo(4.5);
  });

  it('데이터 시작(d4) 클립 시 effectZX 정직화 → 미flag', () => {
    // seedStartById로 Z의 데이터 시작 'd4' 주입: d0..d3 제외 → Z off {d8,d9} c=1,d=1 → rateOff=0.5 →
    // effect=1.5 < 2.0 → 컷. overlap(=1.0)·nCofire(=3)는 양쪽 동일 → effectZX만 판정 뒤집음.
    const seedStartById = new Map<number, string | null>([[9, 'd4']]);
    const r = flagConfoundersForLink(1, S, X, [Z], 'today', Tclip, null, seedStartById);
    expect(r.suspected).toHaveLength(0);
  });

  it('baseStart(신호·시드 데이터 시작 합성)로도 동일 클립', () => {
    // baseStart='d4' 경로(신호 X 또는 시드 S 데이터 시작이 d4인 케이스) — seedStartById 없이도 컷.
    const r = flagConfoundersForLink(1, S, X, [Z], 'today', Tclip, 'd4');
    expect(r.suspected).toHaveLength(0);
  });
});

// ─── P7 다변량 분리 (Mantel-Haenszel 조정 — ADR-0042) ────

// 큰 윈도우 합성 빌더 — 게이트(nCofire≥30)·층 viability를 충족하도록 셀을 정확히 깐다.
const buildN = (n: number) => {
  const days = Array.from({ length: n }, (_, i) => `d${i}`);
  const rangeSet = (...ranges: [number, number][]): Set<string> => {
    const s = new Set<string>();
    for (const [lo, hi] of ranges) for (let i = lo; i <= hi; i++) s.add(`d${i}`);
    return s;
  };
  return {
    m: (...ranges: [number, number][]): Map<string, boolean> => {
      const set = rangeSet(...ranges);
      return new Map(days.map((d) => [d, set.has(d)]));
    },
    s: (...ranges: [number, number][]): DaySeries => {
      const set = rangeSet(...ranges);
      return new Map(days.map((d) => [d, set.has(d)]));
    },
  };
};

const AT: ConfoundAdjustThresholds = {
  adjustMinCofire: 30,
  explainAwayMaxEffect: 1.3,
  attenuatedMaxRatio: 0.8,
  minStratumCell: 5,
};

const susp = (
  seedId: number,
  nCofire: number,
  overlap = 0.8,
  effectZX = 1.7,
): SuspectedConfounder => ({
  seedId,
  seedName: `Z${seedId}`,
  overlap,
  effectZX,
  nCofire,
});

const cand = (seedId: number, act: Map<string, boolean>): ConfoundCandidate => ({
  seedId,
  seedName: `Z${seedId}`,
  act,
});

describe('classifyVerdict', () => {
  it('adjEffect < explainAwayMaxEffect → explained_away', () => {
    expect(classifyVerdict(1.0, 2.0, AT)).toBe('explained_away');
  });
  it('explainAway ≤ adjEffect < marginal·ratio → attenuated', () => {
    expect(classifyVerdict(1.4, 2.0, AT)).toBe('attenuated'); // 1.4≥1.3 ∧ 1.4<1.6
  });
  it('adjEffect ≥ marginal·ratio → survives', () => {
    expect(classifyVerdict(1.8, 2.0, AT)).toBe('survives'); // 1.8≥1.6
  });
  it('marginal 비유한 → attenuated 밴드 skip → survives', () => {
    expect(classifyVerdict(1.5, NaN, AT)).toBe('survives');
  });
});

describe('buildStrata', () => {
  it('1 교란 → 2층, 셀 합 = 비층화 2×2 (보존)', () => {
    const b = buildN(8);
    const aS = b.m([0, 3]); // S active d0..d3
    const aZ = b.m([0, 1], [4, 5]); // Z active d0,d1,d4,d5
    const x = b.s([0, 2], [4, 6]);
    const strata = buildStrata(aS, x, [cand(2, aZ)]);
    expect(strata).toHaveLength(2);
    const sum = (k: 'a' | 'b' | 'c' | 'd') => strata.reduce((acc, st) => acc + st[k], 0);
    const flat = buildContingency(aS, x);
    expect(sum('a')).toBe(flat.a);
    expect(sum('b')).toBe(flat.b);
    expect(sum('c')).toBe(flat.c);
    expect(sum('d')).toBe(flat.d);
  });

  it('windowStart 이전 날은 층 배정 전 제외 → 셀 합 = 클립된 2×2 (#556)', () => {
    const b = buildN(8);
    const aS = b.m([0, 3]);
    const aZ = b.m([0, 1], [4, 5]);
    const x = b.s([0, 2], [4, 6]);
    // windowStart='d2' → d0,d1 제외. 층 합이 같은 windowStart로 클립한 flat 2×2와 일치해야 함.
    const strata = buildStrata(aS, x, [cand(2, aZ)], 'd2');
    const sum = (k: 'a' | 'b' | 'c' | 'd') => strata.reduce((acc, st) => acc + st[k], 0);
    const flat = buildContingency(aS, x, 'd2');
    expect(sum('a')).toBe(flat.a);
    expect(sum('b')).toBe(flat.b);
    expect(sum('c')).toBe(flat.c);
    expect(sum('d')).toBe(flat.d);
    // 클립 전(d0,d1 포함)과 셀 합이 실제로 다름을 확인(no-op 아님).
    const flatNoClip = buildContingency(aS, x);
    expect(flat.a + flat.b + flat.c + flat.d).toBeLessThan(
      flatNoClip.a + flatNoClip.b + flatNoClip.c + flatNoClip.d,
    );
  });
});

describe('adjustConfounders', () => {
  it('게이트 미달(nCofire < adjustMinCofire) → undefined (dormant)', () => {
    const b = buildN(120);
    const actZ = b.m([0, 59]);
    const aS = b.m([0, 39], [60, 79]);
    const x = b.s([0, 35], [40, 57], [60, 61], [80, 83]);
    const candById = new Map([[2, cand(2, actZ)]]);
    const r = adjustConfounders({ actS: aS, sigX: x, suspected: [susp(2, 20)], candById }, AT);
    expect(r).toBeUndefined();
  });

  it('후보 시리즈 없음(candById 누락) → undefined', () => {
    const b = buildN(120);
    const aS = b.m([0, 39], [60, 79]);
    const x = b.s([0, 35]);
    const r = adjustConfounders(
      { actS: aS, sigX: x, suspected: [susp(7, 40)], candById: new Map() },
      AT,
    );
    expect(r).toBeUndefined();
  });

  it('게이트 통과 + 완전 교란 → explained_away (노출 강등 대상, RR≈1.0)', () => {
    // Z-on(d0..59)/Z-off(d60..119) 각 층 내 S↔X 연관 없음, marginal만 연관(어부지리).
    const b = buildN(120);
    const actZ = b.m([0, 59]);
    const aS = b.m([0, 39], [60, 79]);
    const x = b.s([0, 35], [40, 57], [60, 61], [80, 83]);
    const candById = new Map([[2, cand(2, actZ)]]);
    const r = adjustConfounders({ actS: aS, sigX: x, suspected: [susp(2, 40)], candById }, AT);
    const adj = r?.adjusted ?? [];
    expect(r?.explainedAway).toBe(true);
    expect(adj).toHaveLength(1);
    expect(adj[0]?.seedId).toBe(2);
    expect(adj[0]?.verdict).toBe('explained_away');
    expect(adj[0]?.adjEffect).toBeCloseTo(1.0);
  });

  it('게이트 통과 + 층 내 연관 유지 → survives (노출 유지, RR≈9.0)', () => {
    const b = buildN(120);
    const actZ = b.m([0, 59]);
    const aS = b.m([0, 39], [60, 79]);
    const x = b.s([0, 35], [40, 41], [60, 77], [80, 83]);
    const candById = new Map([[2, cand(2, actZ)]]);
    const r = adjustConfounders({ actS: aS, sigX: x, suspected: [susp(2, 40)], candById }, AT);
    const adj = r?.adjusted ?? [];
    expect(r?.explainedAway).toBe(false);
    expect(adj[0]?.verdict).toBe('survives');
    expect(adj[0]?.adjEffect).toBeCloseTo(9.0);
  });

  it('joint 층 viability 미달 → 가장 강한 단일 Z로 fallback', () => {
    const b = buildN(80);
    const aS = b.m([0, 59]); // S active d0..d59
    const actZ1 = b.m([0, 49], [60, 69]); // nCofire(S,Z1)=50
    const actZ2 = b.m([0, 47], [60, 69]); // nCofire(S,Z2)=48 → (Z1=1,Z2=0)=d48,d49 sparse
    const x = b.s([0, 40], [60, 75]);
    const candById = new Map([
      [1, cand(1, actZ1)],
      [2, cand(2, actZ2)],
    ]);
    // Z1 overlap×effectZX 더 큼 → fallback이 Z1 선택.
    const suspected = [susp(1, 50, 0.9, 2.0), susp(2, 48, 0.85, 2.0)];
    const r = adjustConfounders({ actS: aS, sigX: x, suspected, candById }, AT);
    const adj = r?.adjusted ?? [];
    expect(adj).toHaveLength(1); // joint(2 교란) 포기 → 단일 Z
    expect(adj[0]?.seedId).toBe(1); // 가장 강한 Z1
  });

  it('baseStart 클립이 빈 과거를 marginal·층화에서 제거 (#556)', () => {
    // explained_away 픽스처를 +20 시프트하고 d000..d019를 빈 과거(S·Z off, X fail)로 채운다.
    // 프로덕션 날짜(ISO YYYY-MM-DD)는 zero-pad라 문자열 < 비교가 숫자 순서와 일치 → 라벨도 zero-pad(3자리).
    // baseStart='d020'로 클립하면 시프트 안 한 원본과 동일한 explained_away RR≈1.0가 나와야 한다.
    const N = 140;
    const days = Array.from({ length: N }, (_, i) => `d${String(i).padStart(3, '0')}`);
    const set = (...ranges: [number, number][]): Set<string> => {
      const s = new Set<string>();
      for (const [lo, hi] of ranges)
        for (let i = lo; i <= hi; i++) s.add(`d${String(i).padStart(3, '0')}`);
      return s;
    };
    const m = (...ranges: [number, number][]): Map<string, boolean> => {
      const on = set(...ranges);
      return new Map(days.map((d) => [d, on.has(d)]));
    };
    const s = (...ranges: [number, number][]): DaySeries => {
      const on = set(...ranges);
      return new Map(days.map((d) => [d, on.has(d)]));
    };
    const actZ = m([20, 79]); // 원본 [0,59] +20
    const aS = m([20, 59], [80, 99]); // 원본 [0,39]∪[60,79] +20
    const x = s([20, 55], [60, 77], [80, 81], [100, 103]); // 원본 [0,35]∪[40,57]∪[60,61]∪[80,83] +20
    const candById = new Map([[2, cand(2, actZ)]]);
    const seedStartById = new Map<number, string | null>([[2, 'd020']]);
    const clipped = adjustConfounders(
      { actS: aS, sigX: x, suspected: [susp(2, 40)], candById, baseStart: 'd020', seedStartById },
      AT,
    );
    expect(clipped?.explainedAway).toBe(true);
    expect(clipped?.adjusted[0]?.verdict).toBe('explained_away');
    expect(clipped?.adjusted[0]?.adjEffect).toBeCloseTo(1.0);

    // 클립 없이 돌리면 빈 과거(d000..d019)의 off·fail이 셀을 부풀려 RR이 1.0에서 벗어난다(no-op 아님 확인).
    const noClip = adjustConfounders({ actS: aS, sigX: x, suspected: [susp(2, 40)], candById }, AT);
    expect(noClip?.adjusted[0]?.adjEffect ?? NaN).not.toBeCloseTo(1.0);
  });
});
