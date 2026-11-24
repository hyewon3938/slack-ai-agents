import type { LLMMessage, LLMToolDefinition } from '../llm.js';

// ---- 상수 ----

export const MAX_TOOL_ROUNDS = 10;
export const MAX_RETRIES = 2;
export const MAX_RATE_LIMIT_RETRIES = 3;
export const LLM_TIMEOUT_MS = 60_000;
export const TOOL_TIMEOUT_MS = 30_000;

// ---- 에이전트 루프 ----

/** 에이전트 루프 결과 */
export interface AgentLoopResult {
  /** 최종 응답 텍스트 */
  text: string;
  /** 루프 중 호출된 도구 이름 목록 (중복 포함) */
  toolNames: string[];
  /** 루프 중 호출된 도구의 arguments 목록 (toolNames와 순서 대응) */
  toolArgs: Record<string, unknown>[];
  /** tool이 __earlyExit 마커를 반환했는지 — 호출자가 최종 메시지 전송을 스킵 */
  earlyExit?: boolean;
}

/** 도구 실행기 타입 */
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>;

/** 에이전트 루프 설정 */
export interface AgentLoopConfig {
  /** 로그 라벨 (예: 'Schedule Agent') */
  label: string;
  /** 시스템 프롬프트 생성 함수 */
  buildSystemPrompt: () => string | Promise<string>;
  /** 도구 목록 제공 함수 */
  getTools: () => Promise<LLMToolDefinition[]>;
  /** 도구 실행기 */
  executeToolCall: ToolExecutor;
  /** 대화 히스토리 (user/assistant 메시지 배열) */
  historyMessages?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
}
/** 루프가 라운드마다 갱신하는 상태 */
export interface LoopState {
  messages: LLMMessage[];
  calledToolNames: string[];
  calledToolArgs: Record<string, unknown>[];
  retryCount: number;
  hallucinationRetried: boolean;
}
