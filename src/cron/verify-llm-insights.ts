/**
 * 프로액티브 인사이트 v2 Phase 2 — pending llm_insights를 후행 검증.
 * 매일 09:10 실행. verify_at <= NOW()인 row 50건씩 처리.
 */

import { query } from '../shared/db.js';
import { executeVerificationSql } from '../shared/llm-insight-verify.js';
import type { InsightVerificationType } from '../shared/llm-insights.js';

interface PendingRow {
  id: number;
  verification_sql: string;
  verification_result_type: InsightVerificationType;
}

const BATCH_LIMIT = 50;

export const verifyLlmInsightsTask = async (): Promise<void> => {
  const result = await query<PendingRow>(
    `SELECT id, verification_sql, verification_result_type
     FROM llm_insights
     WHERE outcome = 'pending' AND verify_at <= NOW()
     ORDER BY verify_at ASC
     LIMIT $1`,
    [BATCH_LIMIT],
  );

  if (result.rows.length === 0) {
    console.warn('[LLM Insight] 검증 대기 0건');
    return;
  }

  let hitCount = 0;
  let missCount = 0;
  let inconclusiveCount = 0;

  for (const row of result.rows) {
    const { outcome, resultJson, errorText } = await executeVerificationSql(
      row.verification_sql,
      row.verification_result_type,
    );
    await query(
      `UPDATE llm_insights
         SET outcome = $1,
             verified_at = NOW(),
             verification_result_json = $2::jsonb,
             verification_error = $3
       WHERE id = $4`,
      [outcome, resultJson ? JSON.stringify(resultJson) : null, errorText, row.id],
    );
    if (outcome === 'hit') hitCount++;
    else if (outcome === 'miss') missCount++;
    else inconclusiveCount++;
  }

  console.warn(
    `[LLM Insight] 검증 완료: ${result.rows.length}건 (hit=${hitCount}, miss=${missCount}, inconclusive=${inconclusiveCount})`,
  );
};
