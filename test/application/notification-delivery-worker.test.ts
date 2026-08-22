import { describe, expect, it, vi } from 'vitest';

import { Notification } from '../../src/domain/notification/notification.js';
import { NotificationDeliveryWorker } from '../../src/application/notification/notification-delivery-worker.js';
import type {
  ClaimedNotification,
  NotificationDeliveryQueue,
} from '../../src/application/notification/notification-delivery-queue.js';
import type { NotificationSender } from '../../src/application/notification/notification-sender.js';

function notification(status: 'QUEUED' | 'FAILED' = 'QUEUED'): Notification {
  const item = Notification.create(
    `notification-${Math.random()}`,
    'recipient-1',
    'PUSH',
    'delivery.status',
    { status },
    `idempotency-${Math.random()}`,
  );
  if (status === 'FAILED') {
    const attemptId = `${item.snapshot().id}-previous`;
    item.beginProcessing(attemptId);
    item.markFailed(attemptId);
  }
  return item;
}

function queueFor(items: ClaimedNotification[]): NotificationDeliveryQueue & {
  markSent: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
} {
  return {
    claim: vi.fn().mockResolvedValue(items),
    markSent: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
  };
}

describe('NotificationDeliveryWorker', () => {
  it('claims durable work, applies domain transitions, sends, and persists success', async () => {
    const item = notification();
    const claimed = { notification: item, attemptId: 'attempt-1', attempts: 0 };
    const queue = queueFor([claimed]);
    const sender: NotificationSender = {
      send: vi.fn().mockResolvedValue({ providerReference: 'provider-1' }),
    };

    const worker = new NotificationDeliveryWorker(queue, sender, { workerId: 'worker-1' });
    await expect(worker.processOnce()).resolves.toBe(1);

    expect(item.snapshot().status).toBe('SENT');
    expect(sender.send).toHaveBeenCalledWith(item, 'attempt-1');
    expect(queue.markSent).toHaveBeenCalledWith(
      'worker-1',
      'attempt-1',
      item,
      'provider-1',
      expect.any(Date),
    );
  });

  it('persists a failed delivery and leaves the notification retryable', async () => {
    const item = notification();
    const claimed = { notification: item, attemptId: 'attempt-2', attempts: 0 };
    const queue = queueFor([claimed]);
    const sender: NotificationSender = {
      send: vi.fn().mockRejectedValue(new Error('provider unavailable')),
    };

    const worker = new NotificationDeliveryWorker(queue, sender, { workerId: 'worker-1' });
    await expect(worker.processOnce()).resolves.toBe(0);

    expect(item.snapshot().status).toBe('FAILED');
    expect(queue.markFailed).toHaveBeenCalledWith(
      'worker-1',
      'attempt-2',
      item,
      expect.any(Date),
    );
  });

  it('does not overlap queue claims or sends within a batch', async () => {
    const first = notification();
    const second = notification();
    const queue = queueFor([
      { notification: first, attemptId: 'attempt-1', attempts: 0 },
      { notification: second, attemptId: 'attempt-2', attempts: 0 },
    ]);
    const send = vi.fn().mockResolvedValue({ providerReference: null });
    const sender: NotificationSender = { send };

    const worker = new NotificationDeliveryWorker(queue, sender, {
      workerId: 'worker-1',
      batchSize: 2,
    });
    await worker.processOnce();

    expect(queue.claim).toHaveBeenCalledWith('worker-1', 2, 30_000, 5, expect.any(Date));
    expect(send).toHaveBeenNthCalledWith(1, first, 'attempt-1');
    expect(send).toHaveBeenNthCalledWith(2, second, 'attempt-2');
  });
});
