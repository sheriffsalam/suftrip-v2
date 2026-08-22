export type RateLimitDecision = Readonly<{
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}>;

export interface RateLimiter {
  check(key: string, now?: number): RateLimitDecision;
}
