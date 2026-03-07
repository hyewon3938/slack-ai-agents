import type { LLMClient, LLMMessage } from './llm.js';
import { CHARACTER_PROMPT } from './personality.js';
import { withTimeout } from './agent-loop.js';

const CHAT_TIMEOUT_MS = 20_000;
const CLASSIFY_TIMEOUT_MS = 10_000;
const CHAT_MAX_RETRIES = 1;
const CHAT_RETRY_DELAY_MS = 1_500;
const FALLBACK_REPLY = '알겠어.';

export type IntentType = 'casual' | 'action';

/** 의도 분류 결과. LLM 분류에서 casual이면 응답도 포함. */
export interface ClassifyResult {
  intent: IntentType;
  /** LLM 분류에서 casual로 판별된 경우 응답 포함 (키워드 빠른 경로는 미포함) */
  casualReply?: string;
}

/**
 * 잡담 전용 시스템 프롬프트 생성.
 * role: "너는 '잔소리꾼'이야. 일정 관리를 도와주는 친구." 같은 역할 설명
 */
const buildChatPrompt = (role: string): string =>
  `${role} 반말로 대화해.\n${CHARACTER_PROMPT}`;

/**
 * 짧은 잡담인지 판별 (동기, 키워드 기반).
 * casualOverrides에 포함된 표현이 있으면 키워드 무관하게 잡담으로 처리.
 */
export const isCasualChat = (
  text: string,
  actionKeywords: string[],
  maxLength: number,
  casualOverrides?: string[],
): boolean => {
  if (text.length > maxLength) return false;
  if (casualOverrides?.some((p) => text.includes(p))) return true;
  return !actionKeywords.some((k) => text.includes(k));
};

/**
 * LLM으로 의도 분류 + casual이면 응답도 생성 (1회 호출).
 *
 * action이면 → { intent: 'action' }
 * casual이면 → { intent: 'casual', casualReply: '...' }
 * 실패 시 → { intent: 'action' } (안전하게 에이전트 루프)
 */
export const classifyIntent = async (
  llmClient: LLMClient,
  text: string,
  agentContext: string,
  role: string,
): Promise<ClassifyResult> => {
  try {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `사용자 메시지의 의도를 분류해.
${agentContext}

action = 봇에게 구체적인 데이터 작업을 시킴 (추가/삭제/조회/수정)
casual = 혼잣말, 감정, 인사, 감사, 다짐, 응원 요청, 안부, 잡담 (데이터 작업이 아닌 모든 대화)

action이면 "action"만 답해.
casual이면 아래 캐릭터로 짧게 응답해 (분류어 없이 응답만):
${buildChatPrompt(role)}`,
      },
      { role: 'user', content: text },
    ];
    const response = await withTimeout(
      llmClient.chat(messages),
      CLASSIFY_TIMEOUT_MS,
      '의도 분류',
    );
    const result = response.text?.trim() ?? '';

    // 빈 응답 또는 "action" → action
    if (!result || result.toLowerCase() === 'action') {
      return { intent: 'action' };
    }

    // action이 아닌 모든 응답을 casual + 응답으로 취급
    return { intent: 'casual', casualReply: result };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console
    console.error('[Casual Chat] 의도 분류 오류:', errorMsg);
    // 분류 실패 시 안전하게 action (에이전트 루프 진행)
    return { intent: 'action' };
  }
};

/**
 * 하이브리드 의도 분류: 키워드 → LLM 2단계.
 *
 * 1단계 (0ms): casualOverrides 매칭 → 즉시 casual (응답 미포함)
 * 2단계 (0ms): 액션 키워드 없음 → 즉시 casual (응답 미포함)
 * 3단계 (~0.5s): 액션 키워드 있지만 애매 → LLM 분류 + 응답 (1회 호출)
 *
 * maxLength 초과 → 즉시 action (긴 메시지는 잡담 아님)
 */
export const classifyMessage = async (
  llmClient: LLMClient,
  text: string,
  actionKeywords: string[],
  maxLength: number,
  agentContext: string,
  role: string,
  casualOverrides?: string[],
): Promise<ClassifyResult> => {
  // 긴 메시지 → action
  if (text.length > maxLength) return { intent: 'action' };

  // casualOverrides 매칭 → 즉시 casual (응답은 별도 생성 필요)
  if (casualOverrides?.some((p) => text.includes(p))) return { intent: 'casual' };

  // 액션 키워드 없음 → 즉시 casual (응답은 별도 생성 필요)
  if (!actionKeywords.some((k) => text.includes(k))) return { intent: 'casual' };

  // 액션 키워드 있지만 애매한 경우 → LLM 분류 + casual 응답 (1회)
  return classifyIntent(llmClient, text, agentContext, role);
};

/**
 * 잡담에 대한 LLM 응답 생성 (1회 재시도 포함).
 * 키워드 빠른 경로에서 casual 판별 후 응답이 필요할 때 사용.
 * LLM 분류 경로에서는 classifyIntent가 응답도 포함하므로 불필요.
 */
export const respondCasualChat = async (
  llmClient: LLMClient,
  text: string,
  role: string,
): Promise<string> => {
  const messages: LLMMessage[] = [
    { role: 'system', content: buildChatPrompt(role) },
    { role: 'user', content: text },
  ];

  for (let attempt = 0; attempt <= CHAT_MAX_RETRIES; attempt++) {
    try {
      const response = await withTimeout(
        llmClient.chat(messages),
        CHAT_TIMEOUT_MS,
        '잡담 LLM',
      );
      return response.text ?? FALLBACK_REPLY;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error(`[Casual Chat] 잡담 응답 오류 (시도 ${attempt + 1}/${CHAT_MAX_RETRIES + 1}):`, errorMsg);

      if (attempt < CHAT_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, CHAT_RETRY_DELAY_MS));
        continue;
      }
    }
  }

  return FALLBACK_REPLY;
};
