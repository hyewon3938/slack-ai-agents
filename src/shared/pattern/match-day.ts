/**
 * 하루치 시드 매칭과 결과 기록 (pattern-match에서 분리).
 */

import { query } from '../db.js';
import type { BandCuts } from './quantile.js';
import { getDailyContext } from './match-context.js';
import { evaluateMetric } from './match-metric.js';
import { loadActiveSeeds } from './match-seeds.js';
import { evaluateTrigger } from './match-trigger.js';
import type {
  DailyContext,
  MetricEvaluation,
  SajuSeedWithMetrics,
  SeedMatchResult,
} from './match-types.js';

// ─── 시드 단일 평가 + 결과 기록 ──────────────────────────

interface NameIdRow {
  name: string;
  id: number;
}

export const buildNameIdMap = async (
  table: 'stems_master' | 'branches_master',
): Promise<Map<string, number>> => {
  const result = await query<NameIdRow>(`SELECT id, name FROM ${table}`);
  return new Map(result.rows.map((r) => [r.name, r.id]));
};

interface CutpointRow {
  target: string;
  low_cut: string;
  high_cut: string;
}

/**
 * strength_band 일별 판정용 저장 컷 로드 (#477 P4a) — target('day_master'|오행) → BandCuts.
 * 주간 검증 엔진이 윈도우 분위수로 산출·저장(strength_band_cutpoints). 없으면 빈 맵 → 발현 없음(정직).
 * 모듈 캐시 안 함 — 봇이 장시간 떠 있어 주간 갱신 컷이 stale해지면 안 됨(매 cron 호출당 1회 로드).
 */
export const loadStrengthCutpoints = async (userId: number): Promise<Map<string, BandCuts>> => {
  const result = await query<CutpointRow>(
    `SELECT target, low_cut, high_cut FROM strength_band_cutpoints WHERE user_id = $1`,
    [userId],
  );
  const map = new Map<string, BandCuts>();
  for (const r of result.rows) {
    map.set(r.target, { low: Number(r.low_cut), high: Number(r.high_cut) });
  }
  return map;
};

/** trigger 통과 시드의 metric 평가 — metric 단위 격리(일부만 fail해도 나머지 보존). */
const evaluateSeedMetrics = async (
  seed: SajuSeedWithMetrics,
  userId: number,
  date: string,
): Promise<MetricEvaluation[]> => {
  const metricEvaluations: MetricEvaluation[] = [];
  for (const m of seed.metrics) {
    try {
      const ev = await evaluateMetric(m, userId, date);
      metricEvaluations.push(ev);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[pattern-match] metric 평가 실패 seed=${seed.name} metric=${m.metric_name}: ${errMsg}`,
      );
    }
  }
  return metricEvaluations;
};

const evaluateSeedForDay = async (
  seed: SajuSeedWithMetrics,
  ctx: DailyContext,
  userId: number,
  date: string,
  stemMap: Map<string, number>,
  branchMap: Map<string, number>,
  strengthCuts: Map<string, BandCuts>,
): Promise<SeedMatchResult> => {
  // Phase 8a: per-seed try/catch — 한 시드 trigger SQL 실패가 cron 전체를 죽이지 않게 격리.
  // 내부 metric try/catch는 trigger 통과 후 일부 metric만 fail하는 케이스 보호 → 보존.
  try {
    const triggerActivated = await evaluateTrigger(seed, ctx, stemMap, branchMap, strengthCuts);

    const metricEvaluations: MetricEvaluation[] = triggerActivated
      ? await evaluateSeedMetrics(seed, userId, date)
      : [];

    // 풀셋 evidence-only 시드(매트릭 없음)는 채점 스킵 — matched=null
    // 마스터 #434 Phase 2: 60+일 evidence 누적 후 Phase 6 LLM 매트릭 제안 슬롯이 활용
    const isEvidenceOnly = seed.metrics.length === 0;
    const matched = isEvidenceOnly
      ? null
      : triggerActivated && metricEvaluations.some((e) => e.passed);
    return {
      seed,
      triggerActivated,
      metricEvaluations,
      matched,
      isEvidenceOnly,
      triggerError: null,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[pattern-match] seed 평가 실패 seed=${seed.name} id=${seed.id}: ${errMsg}`);
    return {
      seed,
      triggerActivated: false,
      metricEvaluations: [],
      matched: null,
      isEvidenceOnly: seed.metrics.length === 0,
      triggerError: errMsg,
    };
  }
};

export const matchAllSeedsForDay = async (
  userId: number,
  date: string,
): Promise<SeedMatchResult[]> => {
  const t0 = Date.now();
  const ctx = await getDailyContext(userId, date);
  if (!ctx) return [];
  const seeds = await loadActiveSeeds(userId);
  if (seeds.length === 0) return [];

  const [stemMap, branchMap, strengthCuts] = await Promise.all([
    buildNameIdMap('stems_master'),
    buildNameIdMap('branches_master'),
    loadStrengthCutpoints(userId),
  ]);

  const results: SeedMatchResult[] = [];
  for (const seed of seeds) {
    results.push(
      await evaluateSeedForDay(seed, ctx, userId, date, stemMap, branchMap, strengthCuts),
    );
  }

  const elapsedMs = Date.now() - t0;
  console.warn(
    `[pattern-match] user=${userId} date=${date} seeds=${seeds.length} elapsed=${elapsedMs}ms`,
  );
  return results;
};

export const recordDailyMatches = async (
  userId: number,
  date: string,
  results: SeedMatchResult[],
): Promise<void> => {
  for (const r of results) {
    // #477 P2: seed_daily_activations = "오늘 발현 시드" 핸드오프 로그 (검증 진실 아님).
    // 검증 컬럼(metric_values·verify_status·error_message)은 078에서 제거 — 검증은 주간 엔진.
    // trigger_activated/matched만 멱등 UPSERT → daily-insight·recent tier·pillar-level이 소비.
    await query(
      `INSERT INTO seed_daily_activations
         (user_id, date, pattern_id, trigger_activated, matched)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, date, pattern_id) DO UPDATE
         SET trigger_activated = EXCLUDED.trigger_activated,
             matched           = EXCLUDED.matched`,
      [userId, date, r.seed.id, r.triggerActivated, r.matched],
    );
  }
};

// ─── 검증 사이클 ─────────────────────────────────────────
// #477 P2: 검증(카운터 확정 + status 전이)은 주간 검증 엔진(pattern-verification)이 raw에서
// 윈도우 재계산(off-day 대조). 본 모듈은 매칭 + 일별 핸드오프 기록까지만 담당.
// (Slack 한 줄 발송 compactMatchedLine은 #477 P2에서 제거 — 사용자가 매일 확인하지 않는 경로.)
