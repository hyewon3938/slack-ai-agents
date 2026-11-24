/**
 * 생활 맥락 빌더.
 * 수면/루틴/일정 데이터를 순수 SQL로 조회해 시스템 프롬프트에 주입할 텍스트 생성.
 * LLM 호출 없이 ~150토큰 분량의 맥락을 제공하여 잔소리 품질 향상.
 */

export type { ContextTiming } from './life/context-types.js';
export { buildLifeContext } from './life/context-build.js';
