import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../rate-limiter.js';

const WINDOW_MS = 60_000;

const storeSize = (limiter: RateLimiter): number =>
  (limiter as unknown as { store: Map<string, unknown> }).store.size;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RateLimiter.check', () => {
  it('한도까지 허용하고 그다음 요청은 거절한다', () => {
    const limiter = new RateLimiter({ windowMs: WINDOW_MS, maxRequests: 3 });

    expect([1, 2, 3, 4].map(() => limiter.check('u'))).toEqual([true, true, true, false]);
  });

  it('첫 요청에서 windowMs가 지나는 순간 다시 허용한다', () => {
    const limiter = new RateLimiter({ windowMs: WINDOW_MS, maxRequests: 1 });
    limiter.check('u');

    vi.advanceTimersByTime(WINDOW_MS - 1);
    expect(limiter.check('u')).toBe(false);

    vi.advanceTimersByTime(1);
    expect(limiter.check('u')).toBe(true);
  });

  it('슬라이딩 윈도우라 만료된 요청 수만큼만 다시 허용한다', () => {
    const limiter = new RateLimiter({ windowMs: WINDOW_MS, maxRequests: 2 });
    limiter.check('u');
    vi.advanceTimersByTime(30_000);
    limiter.check('u');

    vi.advanceTimersByTime(30_000);

    expect(limiter.check('u')).toBe(true);
    expect(limiter.check('u')).toBe(false);
  });

  it('거절된 요청은 기록하지 않아 제한 시간을 늘리지 않는다', () => {
    const limiter = new RateLimiter({ windowMs: WINDOW_MS, maxRequests: 1 });
    limiter.check('u');
    vi.advanceTimersByTime(50_000);
    expect(limiter.check('u')).toBe(false);

    vi.advanceTimersByTime(10_000);

    expect(limiter.check('u')).toBe(true);
  });

  it('키마다 따로 센다', () => {
    const limiter = new RateLimiter({ windowMs: WINDOW_MS, maxRequests: 1 });
    limiter.check('a');

    expect(limiter.check('a')).toBe(false);
    expect(limiter.check('b')).toBe(true);
  });
});

describe('RateLimiter.cleanup', () => {
  it('윈도우 안에 기록이 없는 키를 지운다', () => {
    const limiter = new RateLimiter({ windowMs: WINDOW_MS, maxRequests: 5 });
    limiter.check('old');
    vi.advanceTimersByTime(WINDOW_MS);
    limiter.check('recent');

    limiter.cleanup();

    expect(storeSize(limiter)).toBe(1);
  });

  it('윈도우 안의 기록은 남겨 한도를 그대로 유지한다', () => {
    const limiter = new RateLimiter({ windowMs: WINDOW_MS, maxRequests: 1 });
    limiter.check('u');

    limiter.cleanup();

    expect(limiter.check('u')).toBe(false);
  });
});
