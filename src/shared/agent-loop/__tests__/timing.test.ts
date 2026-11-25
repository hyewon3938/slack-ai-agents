import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseRetryDelay, withTimeout } from '../timing.js';

// ─── parseRetryDelay ────────────────────────────────────

describe('parseRetryDelay', () => {
  it('소수 초를 밀리초로 바꾼다', () => {
    expect(parseRetryDelay('retry in 12.5s', 60_000)).toBe(12_500);
  });

  it('대소문자와 숫자 뒤 공백을 가리지 않는다', () => {
    expect(parseRetryDelay('Please Retry in 7 s.', 60_000)).toBe(7_000);
  });

  it('대기 시간이 없으면 기본값을 돌려준다', () => {
    expect(parseRetryDelay('429 rate_limit_error', 60_000)).toBe(60_000);
  });
});

// ─── withTimeout ────────────────────────────────────────

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('제한 시간 안에 끝나면 원래 값을 돌려준다', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1_000, '작업')).resolves.toBe('ok');
  });

  it('제한 시간을 넘기면 라벨과 초를 담은 오류로 거절한다', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<never>(() => {}), 30_000, '도구 query_db');
    const assertion = expect(pending).rejects.toThrow('도구 query_db timeout (30s)');

    await vi.advanceTimersByTimeAsync(30_000);

    await assertion;
  });
});
