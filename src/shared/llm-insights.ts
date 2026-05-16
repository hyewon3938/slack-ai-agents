/**
 * 프로액티브 인사이트 v2 Phase 2 — LLM 자율 분석 코어.
 *
 * 컨텍스트 빌드 → LLM 호출 → 응답 검증 → llm_insights 영속.
 * 안전장치 + 컨텍스트 빌더는 llm-insight-prompts.ts에 격리.
 */

import type { LLMClient, LLMMessage } from './llm.js';
import { query } from './db.js';
import {
  buildLlmInsightContext,
  systemPromptForAutonomousAnalysis,
  validateLlmInsightResponse,
  type LlmInsightDraft,
} from './llm-insight-prompts.js';

export type InsightSlot = 'weekly' | 'monthly';
export type InsightConfidence = 'high' | 'medium';
export type InsightVerificationType = 'boolean' | 'scalar_count' | 'ratio';

export const runAutonomousAnalysis = async (
  llm: LLMClient,
  userId: number,
  slot: InsightSlot,
): Promise<LlmInsightDraft[]> => {
  const context = await buildLlmInsightContext(userId, slot);
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPromptForAutonomousAnalysis(slot) },
    { role: 'user', content: `user_id = ${userId}\n\n${context.text}` },
  ];
  const response = await llm.chat(messages);
  return validateLlmInsightResponse(response.text ?? '');
};

export const persistLlmInsights = async (
  userId: number,
  slot: InsightSlot,
  drafts: LlmInsightDraft[],
): Promise<void> => {
  for (const d of drafts) {
    const verifyAt = new Date(Date.now() + d.verification.verifyAfterDays * 86_400_000);
    await query(
      `INSERT INTO llm_insights (
         user_id, slot, signal_text, hypothesis_text, domains, confidence,
         verification_sql, verification_result_type, verify_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        userId,
        slot,
        d.signal,
        d.hypothesis,
        d.domains,
        d.confidence,
        d.verification.sql,
        d.verification.resultType,
        verifyAt,
      ],
    );
  }
};
