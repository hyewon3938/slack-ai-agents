import type { LLMClient, LLMMessage } from './llm.js';

const CHAT_TIMEOUT_MS = 15_000;
const FALLBACK_REPLY = '알겠어.';

/** Promise에 타임아웃을 적용하는 유틸리티 */
const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout (${ms / 1000}s)`)), ms),
    ),
  ]);
};

/**
 * 잡담 전용 시스템 프롬프트 생성.
 * role: "너는 내 일정 관리를 도와주는 잔소리꾼 친구야." 같은 한 줄 역할 설명
 */
const buildChatPrompt = (role: string): string =>
  `${role} 반말로 대화해.
성격: 겉으로는 쿨하고 무심한 척하지만 은근히 잘 챙기는 츤데레.
- 걱정을 직접 말하지 않고 실용적인 말로 돌려서 전해. 예: "일찍 자. 내일 할 거 있으니까."
- 칭찬도 쿨하게. 예: "뭐, 당연한 거지." / "그 정도는 해야지."
- 진짜 고생했으면 "...수고했어." 처럼 살짝 본심이 나와.
어미: ~자, ~겠어, ~봐, ~써, ~해, ~어. 훈장님처럼 ~거라 금지.
이모지/존댓말 금지. 한두 문장으로 짧게 응답해.`;

/**
 * 짧은 잡담인지 판별 (도구 불필요).
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
 * 잡담에 대한 LLM 응답 생성.
 * 짧은 프롬프트로 빠르게 응답하고, 실패 시 폴백 메시지 반환.
 */
export const respondCasualChat = async (
  llmClient: LLMClient,
  text: string,
  role: string,
): Promise<string> => {
  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: buildChatPrompt(role) },
      { role: 'user', content: text },
    ];
    const response = await withTimeout(
      llmClient.chat(messages),
      CHAT_TIMEOUT_MS,
      '잡담 LLM',
    );
    return response.text ?? FALLBACK_REPLY;
  } catch {
    return FALLBACK_REPLY;
  }
};
