import type { RateLimitDecision, RateLimiter } from '../../application/rate-limit/rate-limiter.js';

type Bucket = {
  count: number;
  resetAt: number;
};

export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Rate limit must be a positive integer');
    if (!Number.isInteger(windowMs) || windowMs < 1) throw new Error('Rate-limit window must be a positive integer');
  }

  check(key: string, now = Date.now()): RateLimitDecision {
    const current = this.buckets.get(key);
    const bucket = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + this.windowMs };

    if (bucket.count >= this.limit) {
      this.buckets.set(key, bucket);
      return { allowed: false, limit: this.limit, remaining: 0, resetAt: bucket.resetAt };
    }

    bucket.count += 1;
    this.buckets.set(key, bucket);
    return {
      allowed: true,
      limit: this.limit,
      remaining: this.limit - bucket.count,
      resetAt: bucket.resetAt,
    };
  }
}
