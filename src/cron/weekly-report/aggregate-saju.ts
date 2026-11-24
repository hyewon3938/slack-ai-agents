import { query } from '../../shared/db.js';
import { DEFAULT_USER_ID } from '../../shared/user-resolver.js';
import type { SajuSeedOutcome, SajuOutcomeData } from './types.js';

// ─── 집계: 사주 시드 outcome ────────────────────────────

/** 누적 ≥ 10일 + hit_rate < 0.3 시드를 "약화 후보"로 표시 */
const WEAK_MIN_TOTAL = 10;
const WEAK_HIT_RATE = 0.3;

interface SajuSeedRow {
  name: string;
  sipsin: string | null;
  description: string | null;
  hit_count: number;
  miss_count: number;
  inconclusive_count: number;
}

export const aggregateSajuOutcome = async (
  userId: number = DEFAULT_USER_ID,
): Promise<SajuOutcomeData> => {
  try {
    const result = await query<SajuSeedRow>(
      `SELECT s.name, s.sipsin, s.description,
              COALESCE(v.total_hits, 0)::int        AS hit_count,
              COALESCE(v.total_misses, 0)::int      AS miss_count,
              COALESCE(v.total_inconclusive, 0)::int AS inconclusive_count
       FROM pattern_catalog s
       LEFT JOIN pattern_summary v ON v.pattern_id = s.id
       WHERE s.user_id = $1 AND s.active = true
       ORDER BY (COALESCE(v.total_hits, 0) + COALESCE(v.total_misses, 0)) DESC, s.name`,
      [userId],
    );
    const seeds: SajuSeedOutcome[] = result.rows.map((row) => {
      const total = row.hit_count + row.miss_count;
      const hitRate = total > 0 ? row.hit_count / total : null;
      return {
        name: row.name,
        sipsin: row.sipsin,
        description: row.description,
        hit: row.hit_count,
        miss: row.miss_count,
        inconclusive: row.inconclusive_count,
        hitRate,
      };
    });
    const weakCandidates = seeds.filter(
      (s) => s.hit + s.miss >= WEAK_MIN_TOTAL && s.hitRate !== null && s.hitRate < WEAK_HIT_RATE,
    );
    return { seeds, weakCandidates };
  } catch {
    return { seeds: [], weakCandidates: [] };
  }
};
