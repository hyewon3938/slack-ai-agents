/**
 * 교란 플래그 + 다변량 분리 엔진 — 공동발현 시드 (#477 P6 ADR-0041, P7 ADR-0042).
 *
 * off-day 검증(P2)은 단일 시드의 **marginal 연관**만 본다. 같은 날 공존하는 제3변수(달력 주기 =
 * 요일·주말·월위치·계절, 또는 다른 사주 시드)가 시드와 신호 둘 다를 끌면 가짜 연관(교란·"어부지리").
 * P6는 claimable(활성·확정) (시드 S × 신호 X) 링크마다 공동발현 교란 시드 Z를 탐지·플래그한다(marginal).
 * P7은 공동발현이 충분히 쌓인(nCofire ≥ 게이트) 쌍만 **Mantel-Haenszel 층화**로 조정 추정치를 산출해
 * 어부지리를 노출에서 실제로 걷어낸다(explained_away → 노출 레이어 soft-demote).
 *
 * 핵심(헌장 ④): 교란변수가 이미 결정론 시드(life_signal 18 + 사주)라 feature 환원이 끝나 있음 →
 * 기존 시드 활성 시리즈 + 기존 2×2(buildContingency/verifyContingency) 재사용. 새 통계 코어는 MH 풀링 하나.
 *
 * P7 데이터 게이트(dormant): nCofire < adjustMinCofire면 조정 안 함 → confound.adjusted 미기록 →
 * 뷰 무변화(배포 시 동작 변화 0). 공동발현 누적 시 다음 주간 run이 자동 조정.
 * e-value·status 불변(ADR-0034 결정론) — 조정은 노출 레이어에서만(ADR-0042 §3).
 * 본 모듈은 순수 계산 + 읽기만. UPDATE pattern_links.confound·카드 발송은 weekly-verification.ts.
 */

import { query } from './db.js';
import {
  buildWindowDates,
  buildContingency,
  verifyContingency,
  computeSignalSeries,
  computeSeedActivationSeries,
  type SignalDef,
  type SignalDirection,
  type DaySeries,
  type Contingency,
} from './pattern-verification.js';
import { mantelHaenszelRR } from './stats.js';
import { loadActiveSeeds, buildNameIdMap, type DailyContext } from './pattern-match.js';
import type { BandCuts } from './quantile.js';
import { INSIGHT_THRESHOLDS } from './insight-thresholds.js';

const T = INSIGHT_THRESHOLDS.confound;
const V = INSIGHT_THRESHOLDS.patternVerification;

// ─── 타입 ────────────────────────────────────────────────

/** 교란 의심 후보 — 링크 시드 S와 공동발현 + 신호 X와도 연관된 제3시드 Z. */
export interface SuspectedConfounder {
  seedId: number;
  seedName: string;
  overlap: number; // P(Z active | S active)
  effectZX: number; // Z↔X rate ratio (발현일 pass율 / 비발현일 pass율)
  nCofire: number; // |actS ∩ actZ| 공동발현일 수 (P7 데이터 게이트 입력)
}

/** 한 링크의 교란 조정 판정 — Z 통제 후 연관이 어떻게 됐는지(P7, ADR-0042). */
export type ConfoundVerdict = 'survives' | 'attenuated' | 'explained_away';

/**
 * 게이트 통과 교란별 MH 조정 결과(P7). joint면 기여 Z마다 같은 adjEffect/verdict 공유(대표 1),
 * fallback이면 단일 Z. 카드·뷰는 explainedAway 플래그 + seedId(이름은 suspected에서 join).
 */
export interface AdjustedConfounder {
  seedId: number;
  adjEffect: number; // MH 조정 rate ratio
  nCofire: number;
  verdict: ConfoundVerdict;
}

/** confound JSONB 형태 — "점검했다"는 사실(scannedAt) + 의심 목록(P6) + 조정 결과(P7, 게이트 통과 시만). */
export interface ConfoundData {
  scannedAt: string;
  suspected: SuspectedConfounder[];
  adjusted?: AdjustedConfounder[]; // P7 — 게이트(nCofire≥adjustMinCofire) 통과 시만(미달이면 키 없음)
  explainedAway?: boolean; // P7 — 링크 verdict가 explained_away면 true(뷰 verified 가드가 읽음)
}

export interface ConfoundResult {
  linkId: number;
  confound: ConfoundData;
}

/** 교란 플래그 임계 (P6, insight-thresholds.confound). 파라미터로 받아 테스트가 커스텀 주입 가능. */
export interface ConfoundThresholds {
  minOverlap: number;
  minCofireDays: number;
  minEffectZX: number;
  topN: number;
}

/** 교란 조정 임계 (P7). insight-thresholds.confound가 두 인터페이스를 모두 구조적으로 만족. */
export interface ConfoundAdjustThresholds {
  adjustMinCofire: number; // 공동발현일 게이트(이상이면 조정)
  explainAwayMaxEffect: number; // 조정 후 이 미만이면 explained_away
  attenuatedMaxRatio: number; // explainAway~marginal·이 값 사이면 attenuated
  minStratumCell: number; // joint 층 viability 최소 셀
}

/** 교란 후보 = active 시드 + 미리 계산된 활성 시리즈. */
export interface ConfoundCandidate {
  seedId: number;
  seedName: string;
  act: Map<string, boolean>;
}

// ─── 순수 계산 ───────────────────────────────────────────

/**
 * S 발현일 대비 Z 공동발현 비율 + 공동발현일 수.
 * overlap = |{d: actS[d] ∧ actZ[d]}| / |{d: actS[d]}|. S 발현 0이면 {0, 0}.
 */
export const computeOverlap = (
  actS: Map<string, boolean>,
  actZ: Map<string, boolean>,
): { overlap: number; nCofire: number } => {
  let sActive = 0;
  let inter = 0;
  for (const [date, active] of actS) {
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
 */
export const flagConfoundersForLink = (
  seedId: number,
  actS: Map<string, boolean>,
  sigX: DaySeries,
  candidates: ConfoundCandidate[],
  today: string,
  t: ConfoundThresholds,
): ConfoundData => {
  const suspected: SuspectedConfounder[] = [];
  for (const z of candidates) {
    if (z.seedId === seedId) continue; // 자기 제외
    const { overlap, nCofire } = computeOverlap(actS, z.act);
    if (overlap < t.minOverlap || nCofire < t.minCofireDays) continue;
    const v = verifyContingency(buildContingency(z.act, sigX));
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
 */
export const buildStrata = (
  actS: Map<string, boolean>,
  sigX: DaySeries,
  confounders: ConfoundCandidate[],
): Contingency[] => {
  const byKey = new Map<string, Map<string, boolean>>();
  for (const [date, active] of actS) {
    const key = confounders.map((z) => (z.act.get(date) ? '1' : '0')).join('');
    let sub = byKey.get(key);
    if (!sub) {
      sub = new Map();
      byKey.set(key, sub);
    }
    sub.set(date, active);
  }
  return [...byKey.values()].map((sub) => buildContingency(sub, sigX));
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
): StrataSelection | undefined => {
  const jointStrata = buildStrata(
    actS,
    sigX,
    pairs.map((p) => p.z),
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
  const singleStrata = buildStrata(actS, sigX, [best.z]);
  if (allStrataViable(singleStrata, t.minStratumCell)) {
    return { strata: singleStrata, controlled: [best.g] };
  }
  return undefined;
};

/** P7 조정 패스 입력 — flagConfoundersForLink 결과 + 후보 활성 시리즈 색인(시리즈 in-hand 공유). */
export interface AdjustInput {
  actS: Map<string, boolean>;
  sigX: DaySeries;
  suspected: SuspectedConfounder[];
  candById: Map<number, ConfoundCandidate>;
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

  // marginal(조정 전) rate ratio — 같은 2×2 프리미티브.
  const marginal = verifyContingency(buildContingency(input.actS, input.sigX)).effect;

  const sel = selectStrata(input.actS, input.sigX, pairs, t);
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

// ─── 읽기 (로더) ─────────────────────────────────────────

interface ClaimableLinkRow {
  link_id: number;
  seed_id: number;
  signal_id: number;
}

interface SignalDefRow {
  id: number;
  name: string;
  kind: 'sql' | 'tag';
  source: 'seed' | 'llm';
  sql_body: string | null;
  value_type: 'binary' | 'continuous' | null;
  direction: SignalDirection | null;
  threshold: string | null;
  tag_name: string | null;
  window_days: number | null;
}

const toSignalDef = (r: SignalDefRow): SignalDef => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  source: r.source,
  sqlBody: r.sql_body,
  valueType: r.value_type,
  direction: r.direction,
  threshold: r.threshold === null ? null : Number(r.threshold),
  tagName: r.tag_name,
  windowDays: r.window_days,
});

/**
 * 한 유저의 claimable 링크(status IN active|confirmed)마다 교란 플래그 산출.
 * confirmed는 sticky라 verifyUserLinks(active만 재검증) results에 없음 → 여기서 독립 로드
 * (카드 노출은 active만, DB 기록은 둘 다 — P7 다변량 분리가 confirmed 링크도 읽음).
 * 시리즈는 self-contained(P5a 발굴과 동형 — 자체 계산·격리, verifyUserLinks 코어 무변경 = blast radius 최소).
 * 시드 활성 시리즈는 시드당 1회(strength_band 2-pass 캐시 공유), 신호 시리즈는 (등장한) 신호당 1회.
 */
export const flagConfounds = async (userId: number, today: string): Promise<ConfoundResult[]> => {
  const linkRes = await query<ClaimableLinkRow>(
    `SELECT l.id AS link_id, l.seed_id, l.signal_id
       FROM pattern_links l
       JOIN signal_defs s ON s.id = l.signal_id
       JOIN pattern_catalog c ON c.id = l.seed_id
      WHERE l.user_id = $1 AND l.status IN ('active', 'confirmed')
        AND s.status = 'active' AND c.active = true
      ORDER BY l.id`,
    [userId],
  );
  if (linkRes.rows.length === 0) return [];

  const windowDates = buildWindowDates(today, V.windowCapDays);
  const [stemMap, branchMap] = await Promise.all([
    buildNameIdMap('stems_master'),
    buildNameIdMap('branches_master'),
  ]);

  // 후보 = 모든 active 시드. 활성 시리즈는 시드당 1회(strength_band 2-pass 캐시 공유).
  const seeds = await loadActiveSeeds(userId);
  const ctxCache = new Map<string, DailyContext | null>();
  const strengthCache = new Map<string, Map<string, number>>();
  const cutCache = new Map<string, BandCuts>();
  const seedActById = new Map<number, Map<string, boolean>>();
  for (const seed of seeds) {
    seedActById.set(
      seed.id,
      await computeSeedActivationSeries(
        seed,
        userId,
        windowDates,
        ctxCache,
        stemMap,
        branchMap,
        strengthCache,
        cutCache,
      ),
    );
  }
  const candidates: ConfoundCandidate[] = [];
  const candById = new Map<number, ConfoundCandidate>();
  for (const seed of seeds) {
    const act = seedActById.get(seed.id);
    if (act) {
      const cand: ConfoundCandidate = { seedId: seed.id, seedName: seed.name, act };
      candidates.push(cand);
      candById.set(seed.id, cand);
    }
  }

  // 링크에 등장한 신호 시리즈(신호당 1회).
  const signalIds = [...new Set(linkRes.rows.map((r) => r.signal_id))];
  const signalRes = await query<SignalDefRow>(
    `SELECT id, name, kind, source, sql_body, value_type, direction, threshold, tag_name, window_days
       FROM signal_defs
      WHERE user_id = $1 AND id = ANY($2::int[]) AND status = 'active'`,
    [userId, signalIds],
  );
  const signalSeriesById = new Map<number, DaySeries>();
  for (const row of signalRes.rows) {
    const r = await computeSignalSeries(userId, toSignalDef(row), windowDates);
    signalSeriesById.set(row.id, r.series);
  }

  const out: ConfoundResult[] = [];
  for (const row of linkRes.rows) {
    const actS = seedActById.get(row.seed_id);
    const sigX = signalSeriesById.get(row.signal_id);
    if (!actS || !sigX) continue;
    // P6 플래그 → P7 조정(게이트 통과 시만). 시리즈 in-hand 공유(재계산 0).
    const confound = flagConfoundersForLink(row.seed_id, actS, sigX, candidates, today, T);
    const adj = adjustConfounders({ actS, sigX, suspected: confound.suspected, candById }, T);
    if (adj) {
      confound.adjusted = adj.adjusted;
      confound.explainedAway = adj.explainedAway;
    }
    out.push({ linkId: row.link_id, confound });
  }
  return out;
};
