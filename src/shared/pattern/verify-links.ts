/**
 * 사용자 링크 주간 검증 (pattern-verification에서 분리).
 */

import { query } from '../db.js';
import { signalLabel } from '../insight-labels.js';
import { INSIGHT_THRESHOLDS } from '../insight-thresholds.js';
import { buildWindowDates } from './binarize.js';
import { computeUserDataStarts, signalDataStart } from './data-window.js';
import { type SignalDefRow, querySignalDefRows, toSignalDef } from './load-signal-defs.js';
import { buildNameIdMap } from './match-day.js';
import { loadActiveSeeds } from './match-seeds.js';
import { computeSeedActivationMap, computeSignalSeriesMap } from './series-map.js';
import type { LinkVerification } from './types.js';
import {
  type ActiveLinkRow,
  type LinkInterimDeps,
  buildLinkInterim,
  finalizeVerifications,
} from './verify-link-calc.js';

const V = INSIGHT_THRESHOLDS.patternVerification;
/** active 링크(신호·시드도 active) 조회 — link id 순. */
const queryActiveLinks = async (userId: number): Promise<{ rows: ActiveLinkRow[] }> => {
  const linkRes = await query<ActiveLinkRow>(
    `SELECT l.id AS link_id, l.seed_id, l.signal_id, l.status,
            l.source, (l.created_at AT TIME ZONE 'Asia/Seoul')::date::text AS created_date
       FROM pattern_links l
       JOIN signal_defs s ON s.id = l.signal_id
       JOIN pattern_catalog c ON c.id = l.seed_id
      WHERE l.user_id = $1 AND l.status = 'active' AND s.status = 'active' AND c.active = true
      ORDER BY l.id`,
    [userId],
  );
  return linkRes;
};

// 카드용 신호 라벨 — 룰(seed) / 자작 description(llm). 로드 지점에서 1회 계산해 문자열로 운반.
const buildSignalLabelById = (signalRows: SignalDefRow[]): Map<number, string> =>
  new Map(
    signalRows.map((r) => [
      r.id,
      signalLabel({
        name: r.name,
        kind: r.kind,
        source: r.source,
        direction: r.direction,
        threshold: r.threshold === null ? null : Number(r.threshold),
        tagName: r.tag_name,
        domain: r.domain,
        description: r.description,
      }),
    ]),
  );

/**
 * 한 유저의 active 링크 전부를 off-day 대조 검증. UPDATE/Slack 없음 — 계산 결과만 반환.
 * BH-FDR은 전 링크 p를 모아 일괄 적용.
 */
export const verifyUserLinks = async (
  userId: number,
  today: string,
): Promise<LinkVerification[]> => {
  const linkRes = await queryActiveLinks(userId);
  if (linkRes.rows.length === 0) return [];

  const seeds = await loadActiveSeeds(userId);
  const seedById = new Map(seeds.map((s) => [s.id, s]));

  const signalIds = [...new Set(linkRes.rows.map((r) => r.signal_id))];
  const signalRows = await querySignalDefRows(signalIds);
  const signalById = new Map(signalRows.map((r) => [r.id, toSignalDef(r)]));
  const signalLabelById = buildSignalLabelById(signalRows);

  const windowDates = buildWindowDates(today, V.windowCapDays);
  const [stemMap, branchMap] = await Promise.all([
    buildNameIdMap('stems_master'),
    buildNameIdMap('branches_master'),
  ]);

  // 데이터-존재 윈도우(#504): 신호별·시드별 시작일을 1회 산출 → 링크마다 max로 클립.
  const dataStarts = await computeUserDataStarts(userId);
  const signalStartById = new Map(
    [...signalById].map(([sid, sig]) => [sid, signalDataStart(sig.domain, dataStarts)]),
  );

  // 신호 시리즈(신호당 1회) — P1 전역화 payoff.
  const signalSeriesById = await computeSignalSeriesMap(
    userId,
    signalById.values(),
    windowDates,
    signalStartById,
    'Verification',
  );
  // 시드 활성 시리즈(시드당 1회) — 링크에 등장한 시드만, 등장 순서대로.
  const linkSeeds = [...new Set(linkRes.rows.map((r) => r.seed_id))].flatMap((seedId) => {
    const seed = seedById.get(seedId);
    return seed ? [seed] : [];
  });
  const seedSeriesById = await computeSeedActivationMap(
    userId,
    linkSeeds,
    windowDates,
    stemMap,
    branchMap,
  );

  // 링크별 2×2(Fisher) + block permutation p + e-value + 연속 MW. q는 block-perm p로 일괄 BH-FDR.
  const deps: LinkInterimDeps = {
    signalById,
    seedById,
    seedSeriesById,
    signalSeriesById,
    signalStartById,
    dataStarts,
    windowDates,
  };
  const interim = linkRes.rows
    .map((row) => buildLinkInterim(row, deps))
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return finalizeVerifications(interim, signalLabelById);
};
