/**
 * 교란 플래그·MH 층화 조정 순수 계산 (confound에서 분리).
 */

import { mantelHaenszelRR } from '../stats.js';
import type {
  AdjustedConfounder,
  ConfoundAdjustThresholds,
  ConfoundCandidate,
  ConfoundData,
  ConfoundThresholds,
  ConfoundVerdict,
  SuspectedConfounder,
} from './confound-types.js';
import { buildContingency, verifyContingency } from './contingency.js';
import { maxDate } from './data-window.js';
import type { Contingency, DaySeries } from './types.js';

// ─── 순수 계산 ───────────────────────────────────────────

/**
 * S 발현일 대비 Z 공동발현 비율 + 공동발현일 수.
 * overlap = |{d: actS[d] ∧ actZ[d]}| / |{d: actS[d]}|. S 발현 0이면 {0, 0}.
 * windowStart(#556): 데이터-존재 구간 시작 이전 날은 빈 과거라 집계 제외
 * (검증 엔진 buildContingency와 동일 클립 — S·Z 둘 다 데이터를 가진 구간만).
 */
export const computeOverlap = (
  actS: Map<string, boolean>,
  actZ: Map<string, boolean>,
  windowStart: string | null = null,
): { overlap: number; nCofire: number } => {
  let sActive = 0;
  let inter = 0;
  for (const [date, active] of actS) {
    if (windowStart !== null && date < windowStart) continue; // 데이터-존재 윈도우 밖(빈 과거)
    if (!active) continue;
    sActive++;
    if (actZ.get(date)) inter++;
  }
  return { overlap: sActive > 0 ? inter / sActive : 0, nCofire: inter };
};

/**
 * 한 링크(시드 S × 신호 X)의 교란 의심 시드 수집.
 * 후보 Z(≠ S)가 둘 다 만족하면 의심: (a) overlap≥minOverlap ∧ nCofire≥minCofireDays(노이즈 바닥),
 * (b) Z↔X 연관 effectZX≥minEffectZX (기존 2×2 재사용). overlap 내림차순 정렬 후 topN cap.
 * (a)만으론 신호와 무관한 겹침 시드까지 다 잡혀 노이즈 폭발 → (b) 필수(ADR-0041 §2).
 *
 * 데이터-존재 윈도우(#556, 검증 엔진 #504 ADR-0044와 동일 클립): overlap·nCofire(Z×S)와 Z×X 2×2는
 * Z가 끼는 계산이라 windowStart = max(baseStart, seedStart_Z)로 클립(각 후보의 시드 데이터 시작일을
 * baseStart에 합성). baseStart = max(seedStart_S, signalStart_X). seedStartById에 시작일 없으면 클립 없음.
 */
export const flagConfoundersForLink = (
  seedId: number,
  actS: Map<string, boolean>,
  sigX: DaySeries,
  candidates: ConfoundCandidate[],
  today: string,
  t: ConfoundThresholds,
  baseStart: string | null = null,
  seedStartById: Map<number, string | null> = new Map(),
): ConfoundData => {
  const suspected: SuspectedConfounder[] = [];
  for (const z of candidates) {
    if (z.seedId === seedId) continue; // 자기 제외
    const zStart = maxDate(baseStart, seedStartById.get(z.seedId) ?? null);
    const { overlap, nCofire } = computeOverlap(actS, z.act, zStart);
    if (overlap < t.minOverlap || nCofire < t.minCofireDays) continue;
    const v = verifyContingency(buildContingency(z.act, sigX, zStart));
    if (!Number.isFinite(v.effect) || v.effect < t.minEffectZX) continue;
    suspected.push({
      seedId: z.seedId,
      seedName: z.seedName,
      overlap,
      effectZX: v.effect,
      nCofire,
    });
  }
  suspected.sort((a, b) => b.overlap - a.overlap);
  return { scannedAt: today, suspected: suspected.slice(0, t.topN) };
};

// ─── 순수 계산 (P7 다변량 분리 — ADR-0042) ──────────────

/**
 * 게이트 통과 교란들의 값 조합으로 윈도우 일자를 층으로 나눠 각 층의 (시드 S × 신호 X) 2×2 산출.
 * confounders k개 → 최대 2^k 층(발현 조합별, 빈 조합은 생성 안 됨). actS 부분집합에 buildContingency
 * 호출 = P6와 같은 프리미티브 재사용(새 통계 코어 0).
 * windowStart(#556): 빈 과거 일자는 층 배정 전에 제외(검증 엔진 buildContingency와 동일 클립).
 */
export const buildStrata = (
  actS: Map<string, boolean>,
  sigX: DaySeries,
  confounders: ConfoundCandidate[],
  windowStart: string | null = null,
): Contingency[] => {
  const byKey = new Map<string, Map<string, boolean>>();
  for (const [date, active] of actS) {
    if (windowStart !== null && date < windowStart) continue; // 데이터-존재 윈도우 밖(빈 과거)
    const key = confounders.map((z) => (z.act.get(date) ? '1' : '0')).join('');
    let sub = byKey.get(key);
    if (!sub) {
      sub = new Map();
      byKey.set(key, sub);
    }
    sub.set(date, active);
  }
  return [...byKey.values()].map((sub) => buildContingency(sub, sigX, windowStart));
};

/** 층 viability — 각 층 n_k ≥ minCell AND S발현·S비발현 양쪽 존재(MH 풀링이 서는 데이터). */
const allStrataViable = (strata: Contingency[], minCell: number): boolean =>
  strata.length > 0 &&
  strata.every((s) => {
    const n = s.a + s.b + s.c + s.d;
    return n >= minCell && s.a + s.b > 0 && s.c + s.d > 0;
  });

/**
 * 조정 verdict — adjEffect를 explainAway 바닥·marginal 약화 밴드와 대조(ADR-0042).
 * adjEffect < explainAwayMaxEffect → explained_away(Z 통제 시 연관 소멸 → 강등).
 * explainAwayMaxEffect ≤ adjEffect < marginal·attenuatedMaxRatio → attenuated(약화, 노출 유지).
 * 그 외 → survives.
 */
export const classifyVerdict = (
  adjEffect: number,
  marginal: number,
  t: ConfoundAdjustThresholds,
): ConfoundVerdict => {
  if (!Number.isFinite(adjEffect)) return 'survives'; // 호출부가 NaN 사전 차단 — 방어
  if (adjEffect < t.explainAwayMaxEffect) return 'explained_away';
  if (Number.isFinite(marginal) && adjEffect < marginal * t.attenuatedMaxRatio) return 'attenuated';
  return 'survives';
};

interface StrataSelection {
  strata: Contingency[];
  controlled: SuspectedConfounder[]; // adjusted 항목에 기록할 기여 교란
}

/** joint(전체 게이트 통과 Z) 시도 → 한 층이라도 viability 미달이면 가장 강한 단일 Z 2층 fallback. */
const selectStrata = (
  actS: Map<string, boolean>,
  sigX: DaySeries,
  pairs: { g: SuspectedConfounder; z: ConfoundCandidate }[],
  t: ConfoundAdjustThresholds,
  windowStart: string | null = null,
): StrataSelection | undefined => {
  const jointStrata = buildStrata(
    actS,
    sigX,
    pairs.map((p) => p.z),
    windowStart,
  );
  if (allStrataViable(jointStrata, t.minStratumCell)) {
    return { strata: jointStrata, controlled: pairs.map((p) => p.g) };
  }
  // fallback: overlap×effectZX 최대 단일 Z(가장 강한 교란).
  let best = pairs[0];
  if (!best) return undefined;
  for (const p of pairs) {
    if (p.g.overlap * p.g.effectZX > best.g.overlap * best.g.effectZX) best = p;
  }
  const singleStrata = buildStrata(actS, sigX, [best.z], windowStart);
  if (allStrataViable(singleStrata, t.minStratumCell)) {
    return { strata: singleStrata, controlled: [best.g] };
  }
  return undefined;
};

/**
 * P7 조정 패스 입력 — flagConfoundersForLink 결과 + 후보 활성 시리즈 색인(시리즈 in-hand 공유).
 * 데이터-존재 윈도우(#556): baseStart = max(seedStart_S, signalStart_X). seedStartById로 게이트 통과 Z의
 * 시드 시작일을 층화 windowStart 합성에 사용(둘 다 없으면 클립 없음 = 기존 동작).
 */
export interface AdjustInput {
  actS: Map<string, boolean>;
  sigX: DaySeries;
  suspected: SuspectedConfounder[];
  candById: Map<number, ConfoundCandidate>;
  baseStart?: string | null;
  seedStartById?: Map<number, string | null>;
}

/**
 * 한 링크의 교란 조정 (P7, ADR-0042) — 게이트 통과 교란을 MH 층화로 통제한 조정 rate ratio 산출.
 * - 게이트(nCofire ≥ adjustMinCofire) 통과 0개 → undefined(dormant, confound.adjusted 미기록 → 뷰 무변화).
 * - joint 층화(cap 3) 시도 → 한 층이라도 viability 미달이면 가장 강한 단일 Z로 fallback.
 * - viability 전멸 / MH 분모 0 → undefined(조정 불가, suspected만 유지).
 * marginal·시리즈는 in-hand(재계산 0). 순수 함수(결정론) → 주간 SET 리플레이 불변.
 */
export const adjustConfounders = (
  input: AdjustInput,
  t: ConfoundAdjustThresholds,
): { adjusted: AdjustedConfounder[]; explainedAway: boolean } | undefined => {
  const gated = input.suspected.filter((s) => s.nCofire >= t.adjustMinCofire).slice(0, 3);
  if (gated.length === 0) return undefined;

  // 게이트 통과 교란과 활성 시리즈 정렬(시리즈 없는 후보 제외).
  const pairs = gated
    .map((g) => ({ g, z: input.candById.get(g.seedId) }))
    .filter((p): p is { g: SuspectedConfounder; z: ConfoundCandidate } => p.z !== undefined);
  if (pairs.length === 0) return undefined;

  // 데이터-존재 윈도우(#556): 층화·marginal은 Z가 끼므로 baseStart에 통제 Z의 시드 시작일도 max 합성.
  const baseStart = input.baseStart ?? null;
  const seedStartById = input.seedStartById ?? new Map<number, string | null>();
  let windowStart = baseStart;
  for (const p of pairs) windowStart = maxDate(windowStart, seedStartById.get(p.g.seedId) ?? null);

  // marginal(조정 전) rate ratio — 같은 2×2 프리미티브(같은 windowStart로 클립).
  const marginal = verifyContingency(buildContingency(input.actS, input.sigX, windowStart)).effect;

  const sel = selectStrata(input.actS, input.sigX, pairs, t, windowStart);
  if (!sel) return undefined;

  const rr = mantelHaenszelRR(sel.strata);
  if (!Number.isFinite(rr)) return undefined;

  const verdict = classifyVerdict(rr, marginal, t);
  const adjusted: AdjustedConfounder[] = sel.controlled.map((g) => ({
    seedId: g.seedId,
    adjEffect: rr,
    nCofire: g.nCofire,
    verdict,
  }));
  return { adjusted, explainedAway: verdict === 'explained_away' };
};
