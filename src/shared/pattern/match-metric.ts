/**
 * 신호(메트릭) 평가 (pattern-match에서 분리).
 */

import { query, queryReadOnly, queryWithClient } from '../db.js';
import { addDays } from '../kst.js';
import { SIGNAL_ROW_CAP, validateSignalSql } from './signal-sql-guard.js';
import type { MetricEvaluation, SajuMetric } from './match-types.js';

const METRIC_TIMEOUT_MS = 5_000;
const BASELINE_WINDOW_DAYS = 28;

// ─── 메트릭 평가 ─────────────────────────────────────────

/** 단일 숫자 신호 결과 추출 — 첫 행 첫 컬럼을 number로 좁힘(없거나 비숫자면 0). */
const extractFirstNumber = (rows: Record<string, unknown>[]): number => {
  const firstRow = rows[0];
  if (!firstRow) return 0;
  const firstValue = Object.values(firstRow)[0];
  if (firstValue === null || firstValue === undefined) return 0;
  if (typeof firstValue === 'number') return firstValue;
  if (typeof firstValue === 'string') {
    const n = Number(firstValue);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

/** 신호 SQL 실행기 — runMetricSql(seed, 신뢰) | runLlmSignalSql(llm, untrusted) 공통 시그니처. */
export type MetricRunner = (sql: string, userId: number, date: string) => Promise<number>;

export const runMetricSql = async (sql: string, userId: number, date: string): Promise<number> => {
  const result = await queryWithClient<Record<string, unknown>>(
    // pg parameter binding은 query() 경로로만 가능, queryWithClient는 raw query.
    // seed metric SQL은 catalog에 영속된 신뢰 SQL이므로 $1/$2 자리에 안전한 값 대입.
    // userId는 INTEGER, date는 'YYYY-MM-DD' 형식 → SQL injection 위험 없음.
    sql.replace(/\$1/g, String(userId)).replace(/\$2/g, `'${date}'`),
    METRIC_TIMEOUT_MS,
  );
  return extractFirstNumber(result.rows);
};

/**
 * LLM 자율 신호 SQL 실행 — 게이트 #2 (#477 P5b, ADR-0040).
 * source='llm' SQL은 untrusted → ① 실행 직전 재검증(저장된 sql_body도 불신, 실패 시 throw)
 * + ② read-only 트랜잭션 격리(INSERT/UPDATE/DELETE를 PG가 거부, 검증 우회 백스톱) + row cap.
 * runMetricSql과 시그니처·반환 동일 → 호출부가 source로 둘 중 하나를 고른다.
 */
export const runLlmSignalSql = async (
  sql: string,
  userId: number,
  date: string,
): Promise<number> => {
  const err = validateSignalSql(sql);
  if (err) throw new Error(`LLM 신호 SQL 검증 실패: ${err}`);
  const result = await queryReadOnly<Record<string, unknown>>(
    sql.replace(/\$1/g, String(userId)).replace(/\$2/g, `'${date}'`),
    METRIC_TIMEOUT_MS,
    SIGNAL_ROW_CAP,
  );
  return extractFirstNumber(result.rows);
};

/** signal_defs.source → 실행기 선택 (llm은 격리 경로). */
export const runnerForSource = (source: 'seed' | 'llm'): MetricRunner =>
  source === 'llm' ? runLlmSignalSql : runMetricSql;

const baselineAvg = async (
  sql: string,
  userId: number,
  date: string,
  runner: MetricRunner = runMetricSql,
): Promise<number> => {
  let sum = 0;
  let n = 0;
  for (let i = 1; i <= BASELINE_WINDOW_DAYS; i++) {
    const d = addDays(date, -i);
    try {
      const v = await runner(sql, userId, d);
      sum += v;
      n++;
    } catch {
      // 단일 날짜 실패는 무시
    }
  }
  return n > 0 ? sum / n : 0;
};

/** tag 신호 — 그날 해당 일기 메타 태그 존재 여부 (binary). */
const tagPresent = async (userId: number, date: string, tagName: string): Promise<boolean> => {
  const result = await query(
    `SELECT 1 FROM diary_meta_tags WHERE user_id = $1 AND date = $2 AND tag = $3 LIMIT 1`,
    [userId, date, tagName],
  );
  return result.rows.length > 0;
};

export const evaluateMetric = async (
  metric: SajuMetric,
  userId: number,
  date: string,
): Promise<MetricEvaluation> => {
  // kind=tag — off-day 대조용 객관 보조 신호. 그날 태그가 찍혔으면 hit(binary).
  if (metric.kind === 'tag') {
    const present = metric.tag_name ? await tagPresent(userId, date, metric.tag_name) : false;
    return {
      metric_name: metric.metric_name,
      domain: metric.domain,
      todayValue: present ? 1 : 0,
      baselineAvg: null,
      threshold: 1,
      direction: 'flag_present',
      passed: present,
    };
  }

  // kind=sql — signal_defs CHECK가 sql_body/direction NOT NULL 보장. 방어적으로 좁힘.
  const sql = metric.expected_metric_sql;
  const direction = metric.expected_direction;
  if (!sql || !direction) {
    return {
      metric_name: metric.metric_name,
      domain: metric.domain,
      todayValue: 0,
      baselineAvg: null,
      threshold: metric.expected_threshold,
      direction: direction ?? 'flag_present',
      passed: false,
    };
  }

  // source='llm'이면 untrusted 격리 실행기(runLlmSignalSql), seed면 기존 신뢰 경로(runMetricSql).
  const runner = runnerForSource(metric.source);
  const todayValue = await runner(sql, userId, date);

  let baseline: number | null = null;
  let passed = false;

  switch (direction) {
    case 'above_avg':
      baseline = await baselineAvg(sql, userId, date, runner);
      passed = todayValue > baseline;
      break;
    case 'below_avg':
      baseline = await baselineAvg(sql, userId, date, runner);
      passed = todayValue < baseline;
      break;
    case 'above_abs':
      passed = todayValue >= (metric.expected_threshold ?? 1);
      break;
    case 'below_abs':
      passed = todayValue <= (metric.expected_threshold ?? 0);
      break;
    case 'flag_present':
      passed = todayValue >= (metric.expected_threshold ?? 1);
      break;
  }

  return {
    metric_name: metric.metric_name,
    domain: metric.domain,
    todayValue,
    baselineAvg: baseline,
    threshold: metric.expected_threshold,
    direction,
    passed,
  };
};
