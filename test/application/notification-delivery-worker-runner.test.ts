import { describe, expect, it, vi } from 'vitest';

import { NotificationDeliveryWorkerRunner } from '../../src/infrastructure/notifications/notification-delivery-worker-runner.js';
import type { NotificationDeliveryWorker } from '../../src/application/notification/notification-delivery-worker.js';

describe('NotificationDeliveryWorkerRunner', () => {
  it('serializes overlapping polls', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    const processOnce = vi.fn()
      .mockImplementationOnce(async () => {
        await blocked;
        return 1;
      })
      .mockResolvedValue(2);

    const worker = { processOnce } as unknown as NotificationDeliveryWorker;
    const runner = new NotificationDeliveryWorkerRunner(worker);

    const first = runner.runOnce();
    const second = await runner.runOnce();
    expect(second).toBe(0);
    expect(processOnce).toHaveBeenCalledTimes(1);

    release();
    await expect(first).resolves.toBe(1);
    await expect(runner.runOnce()).resolves.toBe(2);
    expect(processOnce).toHaveBeenCalledTimes(2);
  });

  it('supports idempotent start and explicit stop', () => {
    const worker = {
      processOnce: vi.fn().mockResolvedValue(0),
    } as unknown as NotificationDeliveryWorker;
    const runner = new NotificationDeliveryWorkerRunner(worker, { pollIntervalMs: 60_000 });

    expect(runner.isRunning()).toBe(false);
    runner.start();
    runner.start();
    expect(runner.isRunning()).toBe(true);
    runner.stop();
    expect(runner.isRunning()).toBe(false);
  });
});
