import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from '../../src/infrastructure/rate-limit/in-memory-rate-limiter.js';

describe('InMemoryRateLimiter', () => {
  it('allows requests up to the configured limit', () => {
    const limiter = new InMemoryRateLimiter(2, 1_000);

    expect(limiter.check('client', 10)).toEqual({ allowed: true, limit: 2, remaining: 1, resetAt: 1_010 });
    expect(limiter.check('client', 20)).toEqual({ allowed: true, limit: 2, remaining: 0, resetAt: 1_010 });
    expect(limiter.check('client', 30)).toEqual({ allowed: false, limit: 2, remaining: 0, resetAt: 1_010 });
  });

  it('resets the bucket at the window boundary', () => {
    const limiter = new InMemoryRateLimiter(1, 1_000);

    expect(limiter.check('client', 10).allowed).toBe(true);
    expect(limiter.check('client', 1_009).allowed).toBe(false);
    expect(limiter.check('client', 1_010)).toEqual({ allowed: true, limit: 1, remaining: 0, resetAt: 2_010 });
  });

  it('isolates keys', () => {
    const limiter = new InMemoryRateLimiter(1, 1_000);

    expect(limiter.check('a', 10).allowed).toBe(true);
    expect(limiter.check('b', 10).allowed).toBe(true);
    expect(limiter.check('a', 11).allowed).toBe(false);
  });
});
