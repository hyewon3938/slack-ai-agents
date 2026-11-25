/**
 * SQL 도구 전용 연결이 없을 때의 LLM 신호 건너뛰기 (#665).
 *
 * 연결이 없는 것은 그날 데이터에 값이 없는 것과 다르므로 결측(null)이나 측정 불가로 기록하지 않는다.
 * 호출부는 그 신호의 측정·채점·저장을 이번 실행에서 건너뛰고, 다음 실행이 다시 측정한다.
 */

import type { SqlToolUnavailableError } from '../db.js';

/**
 * 이름으로 판별한다 — db.js를 모듈째 모킹한 테스트에서도 클래스 import 없이 동작하게.
 * db.ts의 SqlToolUnavailableError가 name을 고정해 둔다.
 */
export const isSqlToolUnavailable = (err: unknown): err is SqlToolUnavailableError =>
  err instanceof Error && err.name === 'SqlToolUnavailableError';

/** 실행 단계마다 한 번만 남기는 건너뛰기 로그. 신호마다 찍지 않도록 건수를 모아 부른다. */
export const logLlmSignalSkip = (scope: string, count: number): void => {
  if (count === 0) return;
  console.error(
    `[${scope}] SQL 도구 전용 연결이 없어 LLM 신호 ${count}개의 측정을 이번 실행에서 건너뜀. 다음 실행에서 다시 측정`,
  );
};
