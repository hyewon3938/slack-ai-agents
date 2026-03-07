/**
 * 크론 알림 LLM 인사 생성 — 양쪽 에이전트 공통.
 * 타임아웃 또는 오류 시 fallback 메시지 반환.
 */
import type { LLMClient, LLMMessage } from './llm.js';
import { GREETING_SYSTEM_PROMPT } from './personality.js';
import { withTimeout } from './agent-loop.js';

const GREETING_LLM_TIMEOUT_MS = 15_000;

/**
 * LLM 기반 인사 메시지 생성.
 * @param llmClient LLM 클라이언트
 * @param prompt 인사 생성 지시 프롬프트
 * @param fallback LLM 실패 시 사용할 폴백 메시지
 */
export const generateGreeting = async (
  llmClient: LLMClient,
  prompt: string,
  fallback: string,
): Promise<string> => {
  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: GREETING_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ];

    const response = await withTimeout(
      llmClient.chat(messages),
      GREETING_LLM_TIMEOUT_MS,
      '인사 LLM',
    );

    return response.text ?? fallback;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console
    console.warn(`[Cron Greeting] LLM 인사 생성 실패 (fallback 사용): ${msg}`);
    return fallback;
  }
};
