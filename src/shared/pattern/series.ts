/**
 * 신호·시드 활성 시리즈 계산 (pattern-verification에서 분리).
 */

import { query } from '../db.js';
import { INSIGHT_THRESHOLDS } from '../insight-thresholds.js';
import { type BandCuts, classifyBand, isBand, tertileCuts } from '../quantile.js';
import type { PillarSet } from '../saju-calendar.js';
import {
  type StrengthTarget,
  computeStrengthForTarget,
  isStrengthTarget,
} from '../saju-strength.js';
import { binarizeSqlSeries } from './binarize.js';
import { getDailyContext } from './match-context.js';
import { runLlmSignalSql, runMetricSql } from './match-metric.js';
import { evaluateTrigger } from './match-trigger.js';
import type { DailyContext, SajuSeedWithMetrics } from './match-types.js';
import type { DaySeries, SignalDef } from './types.js';

const V = INSIGHT_THRESHOLDS.patternVerification;
// ─── 읽기 (시리즈 계산) ──────────────────────────────────

/** 신호 시리즈 결과. raw는 sql continuous 신호일 때만 non-null(Mann-Whitney 보고용). */
export interface SignalSeriesResult {
  series: DaySeries;
  raw: Map<string, number | null> | null;
}

/**
 * 신호 일자 시리즈 (신호당 1회). tag=태그 존재 여부, sql=raw 시리즈 → binarize(+continuous는 raw 보존).
 * dataStart(#504): 그 신호 도메인의 첫 기록일. 이전 날은 결측(null)으로 처리 — 빈 과거의 COALESCE 0이
 * "발현 안 함=fail"로 새거나 rolling baseline을 0으로 오염시키는 측정 아티팩트를 차단(그 날 SQL도 스킵).
 */
export const computeSignalSeries = async (
  userId: number,
  signal: SignalDef,
  windowDates: string[],
  dataStart: string | null = null,
): Promise<SignalSeriesResult> => {
  if (windowDates.length === 0) return { series: new Map(), raw: null };
  const beforeStart = (d: string): boolean => dataStart !== null && d < dataStart;
  if (signal.kind === 'tag') {
    if (!signal.tagName) return { series: new Map(windowDates.map((d) => [d, false])), raw: null };
    const res = await query<{ date: string }>(
      `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date
         FROM diary_meta_tags
        WHERE user_id = $1 AND tag = $2 AND date >= $3 AND date <= $4`,
      [userId, signal.tagName, windowDates[0], windowDates[windowDates.length - 1]],
    );
    const present = new Set(res.rows.map((r) => r.date));
    // 태깅 시작 이전(diary_meta 첫 기록 전)은 결측 — "태그 없음=fail"로 세지 않음.
    return {
      series: new Map(windowDates.map((d) => [d, beforeStart(d) ? null : present.has(d)])),
      raw: null,
    };
  }
  // kind === 'sql'
  if (!signal.sqlBody || !signal.direction) {
    return { series: new Map(windowDates.map((d) => [d, null])), raw: null };
  }
  // source='llm'이면 untrusted 격리 실행기(게이트 #2), seed면 기존 신뢰 경로.
  const runner = signal.source === 'llm' ? runLlmSignalSql : runMetricSql;
  const raw = new Map<string, number | null>();
  for (const d of windowDates) {
    if (beforeStart(d)) {
      raw.set(d, null); // 데이터-존재 이전 = 결측(0 아님). SQL 실행도 생략.
      continue;
    }
    try {
      raw.set(d, await runner(signal.sqlBody, userId, d));
    } catch {
      raw.set(d, null);
    }
  }
  const series = binarizeSqlSeries(
    raw,
    windowDates,
    signal.direction,
    signal.threshold,
    signal.windowDays ?? V.baselineWindowDays,
  );
  // continuous 신호만 raw 보존(MW). binary(flag_present 등)는 raw 불필요.
  return { series, raw: signal.valueType === 'continuous' ? raw : null };
};

/** 연속 신호 raw를 발현/비발현으로 분리 (Mann-Whitney 입력). 측정불가(null)일·윈도우 밖 제외. */
export const splitRawByActivation = (
  activation: Map<string, boolean>,
  raw: Map<string, number | null>,
  windowDates: string[],
  windowStart: string | null = null,
): { active: number[]; off: number[] } => {
  const active: number[] = [];
  const off: number[] = [];
  for (const date of windowDates) {
    if (windowStart !== null && date < windowStart) continue; // 데이터-존재 윈도우 밖 — #504
    const v = raw.get(date);
    if (v === null || v === undefined) continue;
    if (activation.get(date)) active.push(v);
    else off.push(v);
  }
  return { active, off };
};

/** DailyContext → 운 풀셋 PillarSet (강도 계산 입력). */
const pillarSetOf = (ctx: DailyContext): PillarSet => ({
  wonguk: ctx.natal.pillars,
  daeun: ctx.daeun,
  seun: ctx.seun,
  wolun: ctx.wolun,
  ilun: ctx.ilun,
});

/** target('day_master'|오행)의 윈도우 강도 시리즈 (강도 계산 불가일은 제외). target별 1회. */
export const computeTargetStrengthSeries = async (
  target: StrengthTarget,
  userId: number,
  windowDates: string[],
  ctxCache: Map<string, DailyContext | null>,
): Promise<Map<string, number>> => {
  const series = new Map<string, number>();
  for (const d of windowDates) {
    let ctx = ctxCache.get(d);
    if (ctx === undefined) {
      ctx = await getDailyContext(userId, d);
      ctxCache.set(d, ctx);
    }
    if (!ctx) continue;
    series.set(d, computeStrengthForTarget(target, ctx.natal.dayMaster, pillarSetOf(ctx)));
  }
  return series;
};

/**
 * 강도 밴드 2-pass 활성 시리즈 (#477 P4a). 분위수가 윈도우 의존이라 per-day 평가 불가:
 *   pass1: target 강도 시리즈(캐시 — 18 밴드 시드가 6 target 공유) →
 *   pass2: tertile 컷(캐시) → 각 날 밴드 매핑 → seed.band 일치 여부.
 * 결정론: 같은 윈도우 → 같은 분위수 → 같은 밴드 시퀀스 (SET 리플레이·e-value 불변, ADR-0034).
 */
const computeStrengthBandActivation = async (
  seed: SajuSeedWithMetrics,
  userId: number,
  windowDates: string[],
  ctxCache: Map<string, DailyContext | null>,
  strengthCache: Map<string, Map<string, number>>,
  cutCache: Map<string, BandCuts>,
): Promise<Map<string, boolean>> => {
  const series = new Map<string, boolean>();
  const aux = seed.trigger_aux ?? {};
  const target = aux['target'];
  const band = aux['band'];
  if (!isStrengthTarget(target) || !isBand(band)) {
    for (const d of windowDates) series.set(d, false);
    return series;
  }
  let strengthSeries = strengthCache.get(target);
  if (!strengthSeries) {
    strengthSeries = await computeTargetStrengthSeries(target, userId, windowDates, ctxCache);
    strengthCache.set(target, strengthSeries);
  }
  let cuts = cutCache.get(target);
  if (!cuts) {
    cuts = tertileCuts([...strengthSeries.values()]);
    cutCache.set(target, cuts);
  }
  for (const d of windowDates) {
    const v = strengthSeries.get(d);
    series.set(d, v !== undefined && classifyBand(v, cuts) === band);
  }
  return series;
};

/** 시드 활성 시리즈 (시드당 1회). strength_band는 2-pass, 그 외는 일자별 evaluateTrigger. */
export const computeSeedActivationSeries = async (
  seed: SajuSeedWithMetrics,
  userId: number,
  windowDates: string[],
  ctxCache: Map<string, DailyContext | null>,
  stemMap: Map<string, number>,
  branchMap: Map<string, number>,
  strengthCache: Map<string, Map<string, number>> = new Map(),
  cutCache: Map<string, BandCuts> = new Map(),
): Promise<Map<string, boolean>> => {
  if (seed.trigger_target_type === 'strength_band') {
    return computeStrengthBandActivation(
      seed,
      userId,
      windowDates,
      ctxCache,
      strengthCache,
      cutCache,
    );
  }
  const series = new Map<string, boolean>();
  for (const d of windowDates) {
    let ctx = ctxCache.get(d);
    if (ctx === undefined) {
      ctx = await getDailyContext(userId, d);
      ctxCache.set(d, ctx);
    }
    if (!ctx) {
      series.set(d, false);
      continue;
    }
    try {
      series.set(d, await evaluateTrigger(seed, ctx, stemMap, branchMap));
    } catch {
      series.set(d, false);
    }
  }
  return series;
};

export const lastActivationDate = (activation: Map<string, boolean>): string | null => {
  let last: string | null = null;
  for (const [date, active] of activation) {
    if (active && (last === null || date > last)) last = date;
  }
  return last;
};
