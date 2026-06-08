/**
 * 패턴 발굴 엔진 — 링크 없는 (시드 × 신호) 여집합을 off-day 대조로 스캔 (#477 P5a, ADR-0039).
 *
 * P4a·P4b가 evidence-only로 남긴 결정론 feature 시드(강도 밴드·관계·효과적 십성)는
 * pattern_links가 없어 주간 검증 엔진(verifyUserLinks — active 링크만)이 안 건드린다 →
 * 영영 검증 안 됨. 발굴은 그 여집합을 기존 off-day 2×2 엔진(검증 프리미티브 재사용)으로 스캔해
 * 발견 q 트랙으로 후보만 surface → pending pattern_link 선INSERT → #insight 승인 카드.
 *
 * 2층 통제(ADR-0039 §2): 느슨한 discoverQ로 *띄우기만*, 확정(믿음)은 승인 후 엄격 e-value 트랙.
 * 거짓 발견의 비용 = 승인 카드 1장이지 거짓 믿음이 아니다. 손박기 mass-wiring 아님(헌장 ②).
 *
 * 본 모듈은 읽기(시리즈 계산) + pending 링크 쓰기까지. 검증 UPDATE·status 전이는 주간 엔진.
 */

import { query } from '../../shared/db.js';
import { blockPermutationP, mannWhitneyU, type MannWhitneyResult } from '../../shared/stats.js';
import {
  buildWindowDates,
  computeSignalSeries,
  computeSeedActivationSeries,
  buildContingency,
  buildDaySequence,
  verifyContingency,
  splitRawByActivation,
  bhFdrByFamily,
  familyOf,
  computeUserDataStarts,
  signalDataStart,
  seedDataStart,
  maxDate,
  type SignalDef,
  type SignalDirection,
  type SignalSeriesResult,
  type Contingency,
  type ContingencyVerification,
  type FdrFamily,
} from '../../shared/pattern-verification.js';
import {
  loadActiveSeeds,
  buildNameIdMap,
  type SajuSeedWithMetrics,
  type DailyContext,
} from '../../shared/pattern-match.js';
import type { BandCuts } from '../../shared/quantile.js';
import { INSIGHT_THRESHOLDS } from '../../shared/insight-thresholds.js';
import { seedLabel, signalLabel } from '../../shared/insight-labels.js';
import { BEHAVIOR_SIGNAL_DOMAIN, type InsightDomain } from '../../shared/insights.js';

const V = INSIGHT_THRESHOLDS.patternVerification;

/**
 * 행동 시드(life_signal · behavior_baseline)의 source 도메인 (#508 ④, ADR-0046).
 * 사주 시드·캘린더 life_signal(weekday/month_position 등)은 행동 도메인이 없어 null → 필터 면제.
 * 동어반복 필터가 "시드 도메인 == 신호 도메인"(같은 행동 두 번 잼)을 surface 전 거를 때 source.
 */
const behaviorSeedDomain = (seed: {
  trigger_target_type: string;
  trigger_aux: Record<string, unknown> | null;
}): InsightDomain | null => {
  if (seed.trigger_target_type !== 'life_signal') return null;
  const aux = seed.trigger_aux ?? {};
  if (aux['kind'] !== 'behavior_baseline') return null;
  const name = aux['signal_name'];
  return typeof name === 'string'
    ? ((BEHAVIOR_SIGNAL_DOMAIN as Record<string, InsightDomain>)[name] ?? null)
    : null;
};

/** 발굴 후보 — 여집합 off-day 대조 통과 (surface 전용, pending 링크로 선INSERT). */
export interface DiscoveryCandidate {
  seedId: number;
  signalId: number;
  seedName: string;
  seedDescription: string | null;
  /** 카드용 자연어 라벨 — seedName 변수명 대체 (#504 P2, ADR-0045). */
  seedLabel: string;
  patternKind: 'saju' | 'life_signal';
  signalName: string;
  signalDescription: string | null;
  /** 카드용 자연어 라벨 — signalName 변수명·깨진 provenance 대체 (#504 P2, ADR-0045). */
  signalLabel: string;
  signalKind: 'sql' | 'tag';
  valueType: 'binary' | 'continuous' | null;
  // off-day 통계 (카드 표시 + 감사)
  rateActive: number; // 발현일 pass율
  rateOff: number; // 비발현일 pass율
  effect: number; // rate ratio (이진 효과크기 + 감사; 연속은 effectSize가 1차)
  // 연속 신호 효과크기 (#504, ADR-0044 §4) — 이진화 rate ratio 대신 Mann-Whitney 기반.
  effectSize: number | null; // Hodges-Lehmann 위치이동(raw 단위, Phase 2 카드용). 이진은 null.
  mwP: number | null; // Mann-Whitney p (연속). 이진은 null.
  sortZ: number; // 표준화 z (연속=MW z, 이진=2-proportion z) — top-N 랭킹 키(감사)
  nActive: number;
  hit: number; // cont.a — pending 링크 hit_count
  miss: number; // cont.b — pending 링크 miss_count
  inconclusive: number; // cont.inconclusive
  fisherP: number; // test_detail 참고
  blockP: number; // p_value (자기상관 보정)
  qValue: number; // 가족별 발견 BH-FDR q
  posteriorAlpha: number;
  posteriorBeta: number;
  posteriorP: number; // provisional (EB 없이 hit/miss prior)
  family: FdrFamily;
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
  domain: string | null;
  description: string | null;
}

interface LoadedSignal {
  def: SignalDef;
  description: string | null;
}

/** active 신호 전부 (description 동반 — 카드 평어용). */
const loadActiveSignals = async (userId: number): Promise<LoadedSignal[]> => {
  const res = await query<SignalDefRow>(
    `SELECT id, name, kind, source, sql_body, value_type, direction, threshold, tag_name, window_days, domain, description
       FROM signal_defs
      WHERE user_id = $1 AND status = 'active'
      ORDER BY id`,
    [userId],
  );
  return res.rows.map((r) => ({
    def: {
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
      domain: r.domain,
    },
    description: r.description,
  }));
};

/** 이미 링크된 (시드, 신호) 쌍 — 모든 status. 여집합 제외 + rejected 재부상/중복 차단. */
const loadLinkedPairs = async (userId: number): Promise<Set<string>> => {
  const res = await query<{ seed_id: number; signal_id: number }>(
    `SELECT seed_id, signal_id FROM pattern_links WHERE user_id = $1`,
    [userId],
  );
  return new Set(res.rows.map((r) => `${r.seed_id}:${r.signal_id}`));
};

interface Survivor {
  seed: SajuSeedWithMetrics;
  signal: LoadedSignal;
  cont: Contingency;
  v: ContingencyVerification;
  blockP: number;
  mannWhitney: MannWhitneyResult | null; // 연속 신호만 (효과크기 보고 + 정렬)
  effectSize: number | null; // Hodges-Lehmann 위치이동(연속). 이진은 null.
  sortZ: number; // 표준화 z (연속=방향 MW z, 이진=2-proportion z) — 혼합 top-N 정렬 키
}

// ─── §4 효과크기 랭킹 헬퍼 (#504, ADR-0044) ───────────────
// 연속 신호를 이진화 rate ratio로 줄세우면(빈 과거 아티팩트로 0 분모 → 폭증) 헌장 위반.
// 연속은 Mann-Whitney 효과크기로, 정렬은 두 타입을 표준화 z로 통일(SNR — 작은 표본은 z가 작아 robust).

/** direction → +1(높을수록 pass) | -1(낮을수록 pass). 연속 효과크기·z 방향 정렬용. */
const directionSign = (direction: SignalDirection | null): number =>
  direction === 'below_avg' || direction === 'below_abs' ? -1 : 1;

/** rank-biserial 상관 (Mann-Whitney U_active → [-1,1] scale-free 효과크기). */
const rankBiserial = (uActive: number, nActive: number, nOff: number): number =>
  nActive > 0 && nOff > 0 ? (2 * uActive) / (nActive * nOff) - 1 : NaN;

/** 2-proportion z (이진 신호 표준화 효과 — 0 분모 rate-ratio 폭증에 robust, 방향 내장). */
const twoProportionZ = (a: number, b: number, c: number, d: number): number => {
  const nA = a + b;
  const nO = c + d;
  const n = nA + nO;
  if (nA === 0 || nO === 0 || n === 0) return NaN;
  const pHat = (a + c) / n;
  const se = Math.sqrt(pHat * (1 - pHat) * (1 / nA + 1 / nO));
  return se > 0 ? (a / nA - c / nO) / se : NaN;
};

/**
 * 미등록 (시드 × 신호) 여집합을 off-day 대조로 스캔 → 발견 q·top-N 통과 후보.
 * 검증 프리미티브 재사용(시드 활성 시리즈·신호 시리즈는 1회씩 계산, P1 전역화 payoff).
 * 사전선별(Fisher) 통과 쌍만 block-perm(Monte Carlo) → 비용 차단. confirm 트랙과 별도 FDR 풀.
 */
export const discoverCandidates = async (
  userId: number,
  today: string,
): Promise<DiscoveryCandidate[]> => {
  const [seeds, signals, linked] = await Promise.all([
    loadActiveSeeds(userId),
    loadActiveSignals(userId),
    loadLinkedPairs(userId),
  ]);
  if (seeds.length === 0 || signals.length === 0) return [];

  const windowDates = buildWindowDates(today, V.windowCapDays);
  const [stemMap, branchMap] = await Promise.all([
    buildNameIdMap('stems_master'),
    buildNameIdMap('branches_master'),
  ]);

  // 데이터-존재 윈도우(#504): 신호별 시작일 기준으로 빈 과거를 결측 처리 → per-pair 클립.
  const dataStarts = await computeUserDataStarts(userId);
  const signalStartById = new Map(
    signals.map((s) => [s.def.id, signalDataStart(s.def.domain, dataStarts)]),
  );

  // 신호 시리즈(신호당 1회) — continuous는 raw 보존(Mann-Whitney 효과크기 §4).
  const signalSeriesById = new Map<number, SignalSeriesResult>();
  for (const s of signals) {
    signalSeriesById.set(
      s.def.id,
      await computeSignalSeries(userId, s.def, windowDates, signalStartById.get(s.def.id) ?? null),
    );
  }
  // 시드 활성 시리즈(시드당 1회, strength_band 2-pass 포함) — ctx·강도·컷 캐시 공유.
  const ctxCache = new Map<string, DailyContext | null>();
  const strengthCache = new Map<string, Map<string, number>>();
  const cutCache = new Map<string, BandCuts>();
  const seedActivationById = new Map<number, Map<string, boolean>>();
  for (const seed of seeds) {
    seedActivationById.set(
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

  // 여집합 후보 → 데이터-존재 윈도우 클립 → 2×2 → 타입별 효과크기 사전선별 → 통과만 block-perm.
  const survivors: Survivor[] = [];
  let droppedSameDomain = 0; // #508 ④ — 동어반복(자기상관) 드롭 카운트(무음 캡 금지, 로그로 가시화)
  for (const seed of seeds) {
    const activation = seedActivationById.get(seed.id);
    if (!activation) continue;
    const seedStart = seedDataStart(seed, dataStarts);
    const seedDom = behaviorSeedDomain(seed); // 행동 시드만 non-null(사주·캘린더는 면제)
    for (const signal of signals) {
      if (linked.has(`${seed.id}:${signal.def.id}`)) continue;
      // 동어반복 필터(#508 ④): 같은 행동을 두 번 잰 자기상관 쌍은 사전선별·FDR 전에 제외(풀 오염 방지).
      if (seedDom !== null && seedDom === signal.def.domain) {
        droppedSameDomain += 1;
        continue;
      }
      const sr = signalSeriesById.get(signal.def.id);
      if (!sr) continue;
      const series = sr.series;
      // 그 시드·그 신호가 둘 다 데이터를 가진 구간으로 클립(빈 과거 = COALESCE 0=fail 아티팩트 차단).
      const windowStart = maxDate(seedStart, signalStartById.get(signal.def.id) ?? null);
      const cont = buildContingency(activation, series, windowStart);
      const v = verifyContingency(cont);
      if (v.nActive < V.discoveryMinActive) continue; // 공통: 발현일 충분

      // 타입별 효과크기 사전선별(§4): 연속=Mann-Whitney 효과크기, 이진=rate ratio + Fisher.
      let mannWhitney: MannWhitneyResult | null = null;
      let effectSize: number | null = null;
      let sortZ: number;
      if (signal.def.valueType === 'continuous' && sr.raw) {
        const split = splitRawByActivation(activation, sr.raw, windowDates, windowStart);
        if (split.active.length === 0 || split.off.length === 0) continue;
        mannWhitney = mannWhitneyU(split.active, split.off);
        const sign = directionSign(signal.def.direction);
        const rb = sign * rankBiserial(mannWhitney.u, split.active.length, split.off.length);
        if (!Number.isFinite(rb) || rb < V.discoveryMinEffectR) continue; // 효과크기 하한(방향 positive)
        if (!Number.isFinite(mannWhitney.p) || mannWhitney.p > V.discoveryMaxFisherP) continue;
        effectSize = mannWhitney.hodgesLehmann;
        sortZ = sign * mannWhitney.z;
      } else {
        if (!Number.isFinite(v.effect) || v.effect < V.discoveryMinEffect) continue;
        if (!Number.isFinite(v.p) || v.p > V.discoveryMaxFisherP) continue;
        sortZ = twoProportionZ(cont.a, cont.b, cont.c, cont.d);
      }
      if (!Number.isFinite(sortZ)) continue;

      const daySeq = buildDaySequence(activation, series, windowDates, windowStart);
      const blockP = blockPermutationP(daySeq, V.blockLen, V.blockPermIters);
      survivors.push({ seed, signal, cont, v, blockP, mannWhitney, effectSize, sortZ });
    }
  }
  if (droppedSameDomain > 0) {
    console.warn(
      `[Discovery] user=${userId} same-domain 자기상관 ${droppedSameDomain}쌍 제외(#508 ④)`,
    );
  }
  if (survivors.length === 0) return [];

  // 가족별 발견 BH-FDR (ADR-0037·0039 §2 — 확정 트랙과 별도 풀, 가족 간 비용 격리).
  const qValues = bhFdrByFamily(survivors.map((s) => ({ p: s.blockP, family: familyOf(s.seed) })));

  const passed: DiscoveryCandidate[] = [];
  survivors.forEach((s, i) => {
    const q = qValues[i] ?? NaN;
    if (!Number.isFinite(q) || q > V.discoverQ) return;
    passed.push({
      seedId: s.seed.id,
      signalId: s.signal.def.id,
      seedName: s.seed.name,
      seedDescription: s.seed.description,
      seedLabel: seedLabel({ name: s.seed.name, description: s.seed.description }),
      patternKind: s.seed.trigger_target_type === 'life_signal' ? 'life_signal' : 'saju',
      signalName: s.signal.def.name,
      signalDescription: s.signal.description,
      signalLabel: signalLabel({
        name: s.signal.def.name,
        kind: s.signal.def.kind,
        source: s.signal.def.source,
        direction: s.signal.def.direction,
        threshold: s.signal.def.threshold,
        tagName: s.signal.def.tagName,
        domain: s.signal.def.domain,
        description: s.signal.description,
      }),
      signalKind: s.signal.def.kind,
      valueType: s.signal.def.valueType,
      rateActive: s.v.rateActive,
      rateOff: s.v.rateOff,
      effect: s.v.effect,
      effectSize: s.effectSize,
      mwP: s.mannWhitney ? s.mannWhitney.p : null,
      sortZ: s.sortZ,
      nActive: s.v.nActive,
      hit: s.cont.a,
      miss: s.cont.b,
      inconclusive: s.cont.inconclusive,
      fisherP: s.v.p,
      blockP: s.blockP,
      qValue: q,
      posteriorAlpha: s.v.posteriorAlpha,
      posteriorBeta: s.v.posteriorBeta,
      posteriorP: s.v.posteriorP,
      family: familyOf(s.seed),
    });
  });

  // top-N (표준화 z 내림차순 — §4: 연속/이진 공통 SNR 척도, 0 분모 폭증에 robust).
  // 드롭 시 로그 — 무음 캡 금지(ADR-0039 단점).
  passed.sort((a, b) => b.sortZ - a.sortZ);
  if (passed.length > V.discoveryTopN) {
    console.warn(
      `[Discovery] user=${userId} 발견 ${passed.length} → top ${V.discoveryTopN} ` +
        `(드롭 ${passed.length - V.discoveryTopN})`,
    );
  }
  return passed.slice(0, V.discoveryTopN);
};

const numOrNull = (v: number): number | null => (Number.isFinite(v) ? v : null);

/**
 * 발굴 후보를 pending pattern_link로 선INSERT (승인 payload = linkId, ADR-0039 §3).
 * 발굴 통계를 test_detail에 동봉(카드·감사). posterior는 provisional(EB 없이 hit/miss prior) —
 * 승인 후 첫 주간 검증이 EB prior로 재계산·SET 덮어씀. ON CONFLICT은 여집합이 보장하나 방어.
 * @returns 새 링크 id, 충돌(이미 존재)이면 null.
 */
export const insertPendingDiscoveryLink = async (
  userId: number,
  c: DiscoveryCandidate,
): Promise<number | null> => {
  // 연속 신호는 Mann-Whitney 효과크기가 1차(§4) → test_type 분기 + 효과크기 동봉.
  const isContinuous = c.valueType === 'continuous';
  const testDetail = JSON.stringify({
    source: 'discovery',
    rate_active: numOrNull(c.rateActive),
    rate_off: numOrNull(c.rateOff),
    n_active: c.nActive,
    hit: c.hit,
    miss: c.miss,
    inconclusive: c.inconclusive,
    effect: numOrNull(c.effect),
    effect_size: c.effectSize === null ? null : numOrNull(c.effectSize),
    mw_p: c.mwP === null ? null : numOrNull(c.mwP),
    sort_z: numOrNull(c.sortZ),
    fisher_p: numOrNull(c.fisherP),
    block_p: numOrNull(c.blockP),
    discover_q: numOrNull(c.qValue),
    family: c.family,
  });
  const res = await query<{ id: number }>(
    `INSERT INTO pattern_links
       (user_id, seed_id, signal_id, source, status, test_type,
        hit_count, miss_count, inconclusive_count, effect, p_value, q_value,
        posterior_alpha, posterior_beta, posterior_p, test_detail)
     VALUES ($1, $2, $3, 'discovery', 'pending', $14,
        $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
     ON CONFLICT (seed_id, signal_id) DO NOTHING
     RETURNING id`,
    [
      userId,
      c.seedId,
      c.signalId,
      c.hit,
      c.miss,
      c.inconclusive,
      numOrNull(c.effect),
      numOrNull(c.blockP),
      numOrNull(c.qValue),
      c.posteriorAlpha,
      c.posteriorBeta,
      numOrNull(c.posteriorP),
      testDetail,
      isContinuous ? 'mann_whitney' : 'fisher_2x2',
    ],
  );
  return res.rows[0]?.id ?? null;
};
