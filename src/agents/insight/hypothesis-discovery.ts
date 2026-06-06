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
import { blockPermutationP } from '../../shared/stats.js';
import {
  buildWindowDates,
  computeSignalSeries,
  computeSeedActivationSeries,
  buildContingency,
  buildDaySequence,
  verifyContingency,
  bhFdrByFamily,
  familyOf,
  type SignalDef,
  type SignalDirection,
  type DaySeries,
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

const V = INSIGHT_THRESHOLDS.patternVerification;

/** 발굴 후보 — 여집합 off-day 대조 통과 (surface 전용, pending 링크로 선INSERT). */
export interface DiscoveryCandidate {
  seedId: number;
  signalId: number;
  seedName: string;
  seedDescription: string | null;
  patternKind: 'saju' | 'life_signal';
  signalName: string;
  signalDescription: string | null;
  signalKind: 'sql' | 'tag';
  // off-day 통계 (카드 표시 + 감사)
  rateActive: number; // 발현일 pass율
  rateOff: number; // 비발현일 pass율
  effect: number; // rate ratio
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
  description: string | null;
}

interface LoadedSignal {
  def: SignalDef;
  description: string | null;
}

/** active 신호 전부 (description 동반 — 카드 평어용). */
const loadActiveSignals = async (userId: number): Promise<LoadedSignal[]> => {
  const res = await query<SignalDefRow>(
    `SELECT id, name, kind, source, sql_body, value_type, direction, threshold, tag_name, window_days, description
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
}

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

  // 신호 시리즈(신호당 1회).
  const signalSeriesById = new Map<number, DaySeries>();
  for (const s of signals) {
    const r = await computeSignalSeries(userId, s.def, windowDates);
    signalSeriesById.set(s.def.id, r.series);
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

  // 여집합 후보 → 2×2 → Fisher 사전선별 → 통과만 block-perm.
  const survivors: Survivor[] = [];
  for (const seed of seeds) {
    const activation = seedActivationById.get(seed.id);
    if (!activation) continue;
    for (const signal of signals) {
      if (linked.has(`${seed.id}:${signal.def.id}`)) continue;
      const series = signalSeriesById.get(signal.def.id);
      if (!series) continue;
      const cont = buildContingency(activation, series);
      const v = verifyContingency(cont);
      // 사전선별(Monte Carlo 차단): 발현일 충분 + positive 연관 + Fisher 유의.
      if (v.nActive < V.discoveryMinActive) continue;
      if (!Number.isFinite(v.effect) || v.effect < V.discoveryMinEffect) continue;
      if (!Number.isFinite(v.p) || v.p > V.discoveryMaxFisherP) continue;
      const daySeq = buildDaySequence(activation, series, windowDates);
      const blockP = blockPermutationP(daySeq, V.blockLen, V.blockPermIters);
      survivors.push({ seed, signal, cont, v, blockP });
    }
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
      patternKind: s.seed.trigger_target_type === 'life_signal' ? 'life_signal' : 'saju',
      signalName: s.signal.def.name,
      signalDescription: s.signal.description,
      signalKind: s.signal.def.kind,
      rateActive: s.v.rateActive,
      rateOff: s.v.rateOff,
      effect: s.v.effect,
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

  // top-N (effect 내림차순). 드롭 시 로그 — 무음 캡 금지(ADR-0039 단점).
  passed.sort((a, b) => b.effect - a.effect);
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
  const testDetail = JSON.stringify({
    source: 'discovery',
    rate_active: numOrNull(c.rateActive),
    rate_off: numOrNull(c.rateOff),
    n_active: c.nActive,
    hit: c.hit,
    miss: c.miss,
    inconclusive: c.inconclusive,
    effect: numOrNull(c.effect),
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
     VALUES ($1, $2, $3, 'discovery', 'pending', 'fisher_2x2',
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
    ],
  );
  return res.rows[0]?.id ?? null;
};
