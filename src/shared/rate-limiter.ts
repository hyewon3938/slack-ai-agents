/** 인메모리 슬라이딩 윈도우 Rate Limiter */

interface RateLimitEntry {
  timestamps: number[];
}

export interface RateLimiterConfig {
  /** 윈도우 크기 (ms) */
  windowMs: number;
  /** 윈도우 내 최대 허용 횟수 */
  maxRequests: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  windowMs: 60_000, // 1분
  maxRequests: 5,
};

export class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private readonly config: RateLimiterConfig;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 요청 허용 여부 확인 + 기록.
   * @returns true = 허용, false = 제한 초과
   */
  check(key: string): boolean {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    let entry = this.store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.store.set(key, entry);
    }

    // 윈도우 밖 타임스탬프 제거
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    if (entry.timestamps.length >= this.config.maxRequests) {
      return false;
    }

    entry.timestamps.push(now);
    return true;
  }

  /** 오래된 엔트리 정리 (메모리 누수 방지, 주기적 호출 권장) */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    for (const [key, entry] of this.store) {
      entry.timestamps = entry.timestamps.filter((t) => t > windowStart);
      if (entry.timestamps.length === 0) {
        this.store.delete(key);
      }
    }
  }
}
