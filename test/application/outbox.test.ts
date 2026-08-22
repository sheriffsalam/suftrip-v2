import { describe, expect, it } from 'vitest';
import { retryDelayMs } from '../../src/application/outbox/outbox-publisher.js';

describe('outbox retry policy', () => {
  it('uses bounded exponential backoff', () => {
    expect(retryDelayMs(1, 1000)).toBe(1000);
    expect(retryDelayMs(2, 1000)).toBe(2000);
    expect(retryDelayMs(3, 1000)).toBe(4000);
  });

  it('caps retry delay at five minutes', () => {
    expect(retryDelayMs(20, 1000)).toBe(300000);
  });
});
