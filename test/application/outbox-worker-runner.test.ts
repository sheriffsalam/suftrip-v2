import { describe, expect, it, vi } from 'vitest';
import type { OutboxWorker } from '../../src/application/outbox/outbox-publisher.js';
import { OutboxWorkerRunner } from '../../src/infrastructure/outbox/outbox-worker-runner.js';

function worker(processOnce: () => Promise<number>): OutboxWorker {
  return { processOnce } as unknown as OutboxWorker;
}

describe('outbox worker runner', () => {
  it('rejects an invalid poll interval', () => {
    expect(() => new OutboxWorkerRunner(worker(async () => 0), { pollIntervalMs: 0 })).toThrow(/positive integer/i);
  });

  it('serializes overlapping manual polls', async () => {
    let release!: () => void;
    let calls = 0;
    const first = new Promise<void>(resolve => { release = resolve; });
    const runner = new OutboxWorkerRunner(worker(async () => {
      calls += 1;
      await first;
      return 1;
    }));

    const running = runner.runOnce();
    expect(await runner.runOnce()).toBe(0);
    expect(calls).toBe(1);
    release();
    expect(await running).toBe(1);
  });

  it('starts polling and stops scheduling future polls', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const runner = new OutboxWorkerRunner(worker(async () => { calls += 1; return 0; }), { pollIntervalMs: 10 });
      runner.start();
      expect(runner.isRunning()).toBe(true);
      await vi.advanceTimersByTimeAsync(35);
      expect(calls).toBeGreaterThanOrEqual(3);
      runner.stop();
      expect(runner.isRunning()).toBe(false);
      const stoppedCalls = calls;
      await vi.advanceTimersByTimeAsync(100);
      expect(calls).toBe(stoppedCalls);
    } finally {
      vi.useRealTimers();
    }
  });
});
