/**
 * 프로액티브 인사이트 v2 Phase 2 — LLM 자율 발견의 검증 SQL을 실행해 hit/miss/inconclusive 판정.
 *
 * 안전장치: 검증 SQL은 영속 시점에서 이미 SELECT-only로 검증됨 (llm-insight-prompts.ts).
 * 여기서는 statement_timeout 적용 + 결과 형식별 분류만 수행.
 */

import { queryWithClient } from './db.js';
import type { InsightVerificationType } from './llm-insights.js';

export type InsightOutcome = 'hit' | 'miss' | 'inconclusive';

export interface VerifyResult {
  outcome: InsightOutcome;
  resultJson: unknown;
  errorText: string | null;
}

const VERIFY_TIMEOUT_MS = 5_000;

const isTruthy = (val: unknown): boolean => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val > 0;
  if (typeof val === 'string') return val === 't' || val === 'true' || val === '1';
  return false;
};

const isPositiveNumber = (val: unknown): boolean => {
  if (typeof val === 'number') return val > 0;
  if (typeof val === 'string') {
    const n = Number(val);
    return Number.isFinite(n) && n > 0;
  }
  return false;
};

export const classifyOutcome = (
  rows: Record<string, unknown>[],
  resultType: InsightVerificationType,
): InsightOutcome => {
  if (rows.length === 0) return 'inconclusive';
  const firstRow = rows[0];
  if (!firstRow) return 'inconclusive';
  const firstValue = Object.values(firstRow)[0];
  if (firstValue === undefined || firstValue === null) return 'inconclusive';

  if (resultType === 'boolean') {
    return isTruthy(firstValue) ? 'hit' : 'miss';
  }
  return isPositiveNumber(firstValue) ? 'hit' : 'miss';
};

export const executeVerificationSql = async (
  sql: string,
  resultType: InsightVerificationType,
): Promise<VerifyResult> => {
  try {
    const result = await queryWithClient<Record<string, unknown>>(sql, VERIFY_TIMEOUT_MS);
    const outcome = classifyOutcome(result.rows, resultType);
    return {
      outcome,
      resultJson: result.rows,
      errorText: null,
    };
  } catch (err) {
    const errorText = err instanceof Error ? err.message : String(err);
    return {
      outcome: 'inconclusive',
      resultJson: null,
      errorText,
    };
  }
};
