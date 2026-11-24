/**
 * 교란 플래그 로더 (confound에서 분리).
 */

import { query } from '../db.js';
import { INSIGHT_THRESHOLDS } from '../insight-thresholds.js';
import { buildWindowDates } from './binarize.js';
import { adjustConfounders, flagConfoundersForLink } from './confound-calc.js';
import type { ConfoundCandidate, ConfoundResult } from './confound-types.js';
import {
  computeUserDataStarts,
  maxDate,
  seedDataStart,
  signalDataStart,
  type UserDataStarts,
} from './data-window.js';
import { buildNameIdMap } from './match-day.js';
import { loadActiveSeeds } from './match-seeds.js';
import type { SajuSeedWithMetrics } from './match-types.js';
import { computeSeedActivationMap } from './series-map.js';
import { computeSignalSeries } from './series.js';
import type { DaySeries } from './types.js';
import { toSignalDef, type SignalDefRow } from './load-signal-defs.js';

const T = INSIGHT_THRESHOLDS.confound;
const V = INSIGHT_THRESHOLDS.patternVerification;
// ─── 읽기 (로더) ─────────────────────────────────────────

interface ClaimableLinkRow {
  link_id: number;
  seed_id: number;
  signal_id: number;
}

const queryClaimableLinks = (userId: number): Promise<{ rows: ClaimableLinkRow[] }> =>
  query<ClaimableLinkRow>(
    `SELECT l.id AS link_id, l.seed_id, l.signal_id
       FROM pattern_links l
       JOIN signal_defs s ON s.id = l.signal_id
       JOIN pattern_catalog c ON c.id = l.seed_id
      WHERE l.user_id = $1 AND l.status IN ('active', 'confirmed')
        AND s.status = 'active' AND c.active = true
      ORDER BY l.id`,
    [userId],
  );

const buildConfoundCandidates = (
  seeds: SajuSeedWithMetrics[],
  seedActById: Map<number, Map<string, boolean>>,
): { candidates: ConfoundCandidate[]; candById: Map<number, ConfoundCandidate> } => {
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
  return { candidates, candById };
};

interface LinkSignalSeries {
  signalStartById: Map<number, string | null>;
  signalSeriesById: Map<number, DaySeries>;
}

// 링크에 등장한 신호 시리즈(신호당 1회). 검증 엔진과 동일하게 각 신호를 자기 도메인 데이터 시작일
// 기준으로 계산 → 빈 과거의 COALESCE 0이 "발현 안 함=fail"로 새거나 rolling baseline을 오염시키는
// 측정 아티팩트 차단(#556 — #504 ADR-0044 데이터-존재 클립을 교란 엔진 P6/P7에도 적용).
const loadLinkSignalSeries = async (
  userId: number,
  linkRows: ClaimableLinkRow[],
  dataStarts: UserDataStarts,
  windowDates: string[],
): Promise<LinkSignalSeries> => {
  const signalIds = [...new Set(linkRows.map((r) => r.signal_id))];
  const signalRes = await query<Omit<SignalDefRow, 'description'>>(
    `SELECT id, name, kind, source, sql_body, value_type, direction, threshold, tag_name, window_days, domain
       FROM signal_defs
      WHERE user_id = $1 AND id = ANY($2::int[]) AND status = 'active'`,
    [userId, signalIds],
  );
  const signalStartById = new Map<number, string | null>();
  const signalSeriesById = new Map<number, DaySeries>();
  for (const row of signalRes.rows) {
    const signal = toSignalDef(row);
    const start = signalDataStart(signal.domain, dataStarts);
    signalStartById.set(row.id, start);
    const r = await computeSignalSeries(userId, signal, windowDates, start);
    signalSeriesById.set(row.id, r.series);
  }
  return { signalStartById, signalSeriesById };
};

interface LinkConfoundDeps extends LinkSignalSeries {
  seedActById: Map<number, Map<string, boolean>>;
  seedStartById: Map<number, string | null>;
  candidates: ConfoundCandidate[];
  candById: Map<number, ConfoundCandidate>;
}

/** 링크 1건의 P6 플래그 + P7 조정. 시리즈 누락이면 null. */
const buildLinkConfound = (
  row: ClaimableLinkRow,
  today: string,
  deps: LinkConfoundDeps,
): ConfoundResult | null => {
  const { seedActById, signalSeriesById, seedStartById, signalStartById } = deps;
  const { candidates, candById } = deps;
  const actS = seedActById.get(row.seed_id);
  const sigX = signalSeriesById.get(row.signal_id);
  if (!actS || !sigX) return null;
  // 데이터-존재 윈도우(#556): 링크(S×X) 기본 클립 = max(시드 S 데이터 시작, 신호 X 데이터 시작).
  // Z가 끼는 계산(overlap·nCofire·Z×X·층화)은 flagConfoundersForLink/adjustConfounders 내부에서
  // 각 후보 Z의 시드 시작일을 baseStart에 추가로 max 합성한다(enrollment 클립은 검증 확정 게이트
  // 전용 — 교란 P6/P7은 annotate-only marginal이라 적용 안 함).
  const baseStart = maxDate(
    seedStartById.get(row.seed_id) ?? null,
    signalStartById.get(row.signal_id) ?? null,
  );
  // P6 플래그 → P7 조정(게이트 통과 시만). 시리즈 in-hand 공유(재계산 0).
  const confound = flagConfoundersForLink(
    row.seed_id,
    actS,
    sigX,
    candidates,
    today,
    T,
    baseStart,
    seedStartById,
  );
  const adj = adjustConfounders(
    { actS, sigX, suspected: confound.suspected, candById, baseStart, seedStartById },
    T,
  );
  if (adj) {
    confound.adjusted = adj.adjusted;
    confound.explainedAway = adj.explainedAway;
  }
  return { linkId: row.link_id, confound };
};

/**
 * 한 유저의 claimable 링크(status IN active|confirmed)마다 교란 플래그 산출.
 * confirmed는 sticky라 verifyUserLinks(active만 재검증) results에 없음 → 여기서 독립 로드
 * (카드 노출은 active만, DB 기록은 둘 다 — P7 다변량 분리가 confirmed 링크도 읽음).
 * 시리즈는 self-contained(P5a 발굴과 동형 — 자체 계산·격리, verifyUserLinks 코어 무변경 = blast radius 최소).
 * 시드 활성 시리즈는 시드당 1회(strength_band 2-pass 캐시 공유), 신호 시리즈는 (등장한) 신호당 1회.
 */
export const flagConfounds = async (userId: number, today: string): Promise<ConfoundResult[]> => {
  const linkRes = await queryClaimableLinks(userId);
  if (linkRes.rows.length === 0) return [];

  const windowDates = buildWindowDates(today, V.windowCapDays);
  const [stemMap, branchMap] = await Promise.all([
    buildNameIdMap('stems_master'),
    buildNameIdMap('branches_master'),
  ]);

  // 데이터-존재 윈도우(#556, 검증 엔진 #504 ADR-0044와 동일 클립): 유저 라이프 테이블별 첫 기록일 1회 산출.
  // 신호·시드별 데이터 시작일을 여기서 계산해 두면 링크마다 max로 합성 → 빈 과거를 비발현/fail로 세지 않음.
  const dataStarts = await computeUserDataStarts(userId);

  // 후보 = 모든 active 시드. 활성 시리즈는 시드당 1회(strength_band 2-pass 캐시 공유).
  const seeds = await loadActiveSeeds(userId);
  const seedStartById = new Map(seeds.map((s) => [s.id, seedDataStart(s, dataStarts)]));
  const seedActById = await computeSeedActivationMap(
    userId,
    seeds,
    windowDates,
    stemMap,
    branchMap,
  );
  const { candidates, candById } = buildConfoundCandidates(seeds, seedActById);

  const { signalStartById, signalSeriesById } = await loadLinkSignalSeries(
    userId,
    linkRes.rows,
    dataStarts,
    windowDates,
  );

  const deps: LinkConfoundDeps = {
    seedActById,
    seedStartById,
    candidates,
    candById,
    signalStartById,
    signalSeriesById,
  };
  const out: ConfoundResult[] = [];
  for (const row of linkRes.rows) {
    const result = buildLinkConfound(row, today, deps);
    if (!result) continue;
    out.push(result);
  }
  return out;
};
