/**
 * 패턴 발굴 후보의 pending 링크 쓰기 (#477 P5a, ADR-0039 §3).
 */

import { query } from '../../shared/db.js';
import type { DiscoveryCandidate } from './hypothesis-discovery-types.js';

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
