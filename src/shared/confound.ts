/**
 * 교란 플래그 엔진 — 공동발현 시드 marginal 탐지 (#477 P6, ADR-0041).
 *
 * off-day 검증(P2)은 단일 시드의 **marginal 연관**만 본다. 같은 날 공존하는 제3변수(달력 주기 =
 * 요일·주말·월위치·계절, 또는 다른 사주 시드)가 시드와 신호 둘 다를 끌면 가짜 연관(교란·"어부지리").
 * P6는 claimable(활성·확정) (시드 S × 신호 X) 링크마다 공동발현 교란 시드 Z를 탐지해 기록한다.
 *
 * 핵심(헌장 ④): 교란변수가 이미 결정론 시드(life_signal 18 + 사주)라 feature 환원이 끝나 있음 →
 * 기존 시드 활성 시리즈 + 기존 2×2(buildContingency/verifyContingency) 재사용. 새 통계 코어 0.
 *
 * annotate-only(ADR-0041 §3): verdict·status·e-value·tier 불변. 강등·다변량 분리는 P7(데이터 게이트).
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
} from './pattern-verification.js';
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

/** confound JSONB 형태 — "점검했다"는 사실(scannedAt) + 의심 목록(없으면 빈 배열). */
export interface ConfoundData {
  scannedAt: string;
  suspected: SuspectedConfounder[];
}

export interface ConfoundResult {
  linkId: number;
  confound: ConfoundData;
}

/** 교란 임계 (insight-thresholds.confound). 파라미터로 받아 테스트가 커스텀 주입 가능. */
export interface ConfoundThresholds {
  minOverlap: number;
  minCofireDays: number;
  minEffectZX: number;
  topN: number;
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
  for (const seed of seeds) {
    const act = seedActById.get(seed.id);
    if (act) candidates.push({ seedId: seed.id, seedName: seed.name, act });
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
    out.push({
      linkId: row.link_id,
      confound: flagConfoundersForLink(row.seed_id, actS, sigX, candidates, today, T),
    });
  }
  return out;
};
