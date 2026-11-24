/**
 * 강도 분위수 컷 산출 (pattern-verification에서 분리).
 */

import { query } from '../db.js';
import { INSIGHT_THRESHOLDS } from '../insight-thresholds.js';
import { tertileCuts } from '../quantile.js';
import { type StrengthTarget, isStrengthTarget } from '../saju-strength.js';
import { buildWindowDates } from './binarize.js';
import type { DailyContext } from './match-types.js';
import { computeTargetStrengthSeries } from './series.js';

const V = INSIGHT_THRESHOLDS.patternVerification;
// ─── 강도 분위수 컷 산출 (#477 P4a, 저장은 weekly-verification) ──

export interface StrengthCutpoint {
  target: StrengthTarget;
  low: number;
  high: number;
  nSamples: number;
}

/**
 * 활성 strength_band 시드가 있는 target별 주간 분위수 컷 산출 (읽기전용).
 * 일별 cron이 이 저장 컷으로 "오늘 밴드"를 판정 → 발현 로그(seed_daily_activations)·recent tier.
 * 주간 검증 엔진은 자체 윈도우로 컷을 재계산하므로(결정론) 이 저장값에 의존하지 않음 — 일별 경로 전용.
 */
export const computeStrengthCutpoints = async (
  userId: number,
  today: string,
): Promise<StrengthCutpoint[]> => {
  const seedRes = await query<{ trigger_aux: Record<string, unknown> | null }>(
    `SELECT trigger_aux FROM pattern_catalog
      WHERE user_id = $1 AND active = true AND trigger_target_type = 'strength_band'`,
    [userId],
  );
  const targets = new Set<StrengthTarget>();
  for (const r of seedRes.rows) {
    const t = r.trigger_aux?.['target'];
    if (isStrengthTarget(t)) targets.add(t);
  }
  if (targets.size === 0) return [];

  const windowDates = buildWindowDates(today, V.windowCapDays);
  const ctxCache = new Map<string, DailyContext | null>();
  const out: StrengthCutpoint[] = [];
  for (const target of targets) {
    const series = await computeTargetStrengthSeries(target, userId, windowDates, ctxCache);
    const values = [...series.values()];
    if (values.length === 0) continue;
    const cuts = tertileCuts(values);
    if (!Number.isFinite(cuts.low) || !Number.isFinite(cuts.high)) continue;
    out.push({ target, low: cuts.low, high: cuts.high, nSamples: values.length });
  }
  return out;
};
