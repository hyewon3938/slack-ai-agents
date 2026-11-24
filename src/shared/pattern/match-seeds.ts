/**
 * 활성 시드 로드 (pattern-match에서 분리).
 */

import { query } from '../db.js';
import type { SajuMetric, SajuSeed, SajuSeedWithMetrics } from './match-types.js';

// ─── 시드 로드 ──────────────────────────────────────────

type SeedRow = SajuSeed;
type MetricRow = SajuMetric;

export const loadActiveSeeds = async (userId: number): Promise<SajuSeedWithMetrics[]> => {
  const seeds = await query<SeedRow>(
    `SELECT id, user_id, name, sipsin, description,
            trigger_target_type, trigger_target_id, trigger_aux, pillar_level,
            active, source
       FROM pattern_catalog
      WHERE user_id = $1 AND active = true
      ORDER BY id`,
    [userId],
  );
  if (seeds.rows.length === 0) return [];

  const ids = seeds.rows.map((s) => s.id);
  // #477 P1: 검증 단위 = (시드 × 신호) 활성 링크 × 활성 신호. pending 링크/신호(LLM 미승인)는 제외.
  const metrics = await query<MetricRow>(
    `SELECT l.id AS link_id, l.seed_id AS pattern_id, s.id AS signal_id,
            s.name AS metric_name, s.kind, s.source,
            s.sql_body AS expected_metric_sql, s.direction AS expected_direction,
            s.threshold AS expected_threshold, s.value_type, s.tag_name, s.domain
       FROM pattern_links l
       JOIN signal_defs s ON s.id = l.signal_id
      WHERE l.seed_id = ANY($1) AND l.status = 'active' AND s.status = 'active'
      ORDER BY l.id`,
    [ids],
  );

  const metricByPattern = new Map<number, SajuMetric[]>();
  for (const m of metrics.rows) {
    const list = metricByPattern.get(m.pattern_id) ?? [];
    list.push(m);
    metricByPattern.set(m.pattern_id, list);
  }

  return seeds.rows.map((s) => ({
    ...s,
    metrics: metricByPattern.get(s.id) ?? [],
  }));
};
