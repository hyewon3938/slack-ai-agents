/** withTimeout이 제한 시간을 넘겼을 때 던지는 오류 (원래 작업은 취소되지 않고 계속될 수 있다) */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timeout (${ms / 1000}s)`);
    this.name = 'TimeoutError';
  }
}

/** Promise에 타임아웃을 적용하는 유틸리티. 먼저 끝나면 타이머를 해제한다. */
export const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/** 에러 메시지에서 "Please retry in Xs" 파싱. 없으면 기본값 반환 */
export const parseRetryDelay = (errorMsg: string, defaultMs: number): number => {
  const match = /retry in (\d+(?:\.\d+)?)\s*s/i.exec(errorMsg);
  if (match?.[1]) {
    return Math.ceil(Number(match[1]) * 1000);
  }
  return defaultMs;
};
