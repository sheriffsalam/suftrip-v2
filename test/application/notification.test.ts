import { describe, expect, it } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/application/auth/authentication.js';
import { InMemoryNotificationRepository } from '../../src/application/notification/in-memory-notification-repository.js';
import {
  CancelNotification,
  CreateNotification,
  GetNotification,
  RetryNotification,
  SendNotification,
} from '../../src/application/notification/notification-use-cases.js';
import type { Notification } from '../../src/domain/notification/notification.js';
import type { NotificationSender } from '../../src/application/notification/notification-sender.js';
import { AuthorizationError, ConflictError, IdempotencyConflictError, NotFoundError } from '../../src/shared/errors.js';

const customer: AuthenticatedPrincipal = { userId: 'user-1', roles: ['CUSTOMER'] };
const otherCustomer: AuthenticatedPrincipal = { userId: 'user-2', roles: ['CUSTOMER'] };
const admin: AuthenticatedPrincipal = { userId: 'admin-1', roles: ['ADMIN'] };

function payload(): Readonly<Record<string, unknown>> {
  return { deliveryId: 'delivery-1', message: 'Your delivery is on the way' };
}

function senderReturning(reference = 'provider-1'): NotificationSender {
  return {
    async send(_notification: Notification, _attemptId: string) {
      return { providerReference: reference };
    },
  };
}

function senderFailing(error = new Error('provider unavailable')): NotificationSender {
  return {
    async send() {
      throw error;
    },
  };
}

async function createNotification(repository: InMemoryNotificationRepository) {
  return new CreateNotification(repository).execute(
    customer,
    'notification-1',
    customer.userId,
    'IN_APP',
    'delivery.status.updated',
    payload(),
    'create-key-1',
  );
}

describe('notification application', () => {
  it('creates a notification and enforces creation idempotency', async () => {
    const repository = new InMemoryNotificationRepository();
    const useCase = new CreateNotification(repository);

    const first = await createNotification(repository);
    const second = await useCase.execute(
      customer,
      'different-id',
      customer.userId,
      'IN_APP',
      'delivery.status.updated',
      payload(),
      'create-key-1',
    );

    expect(first.id).toBe(second.id);
    expect(second.status).toBe('QUEUED');
  });

  it('rejects a conflicting creation id before leaking another users notification', async () => {
    const repository = new InMemoryNotificationRepository();
    await createNotification(repository);
    const useCase = new CreateNotification(repository);

    await expect(
      useCase.execute(otherCustomer, 'notification-2', customer.userId, 'IN_APP', 'x', payload(), 'create-key-1'),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('rejects unauthorized reads and operations', async () => {
    const repository = new InMemoryNotificationRepository();
    await createNotification(repository);
    const get = new GetNotification(repository);
    const send = new SendNotification(repository, senderReturning());

    await expect(get.execute(otherCustomer, 'notification-1')).rejects.toBeInstanceOf(AuthorizationError);
    await expect(send.execute(otherCustomer, 'notification-1', 'send-key-1')).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('sends successfully and persists the completed attempt', async () => {
    const repository = new InMemoryNotificationRepository();
    await createNotification(repository);
    const result = await new SendNotification(repository, senderReturning('provider-42')).execute(
      customer,
      'notification-1',
      'send-key-1',
    );

    expect(result.notification.status).toBe('SENT');
    expect(result.notification.version).toBe(2);
    expect(result.attempt.status).toBe('SENT');
    expect(result.attempt.providerReference).toBe('provider-42');
  });

  it('persists failure and allows retry after a failed delivery', async () => {
    const repository = new InMemoryNotificationRepository();
    await createNotification(repository);
    const failing = new SendNotification(repository, senderFailing());

    await expect(failing.execute(customer, 'notification-1', 'send-key-1')).rejects.toThrow('provider unavailable');
    expect((await new GetNotification(repository).execute(customer, 'notification-1')).status).toBe('FAILED');

    const retry = await new RetryNotification(repository, senderReturning('provider-retry')).execute(
      customer,
      'notification-1',
      'retry-key-1',
    );
    expect(retry.notification.status).toBe('SENT');
    expect(retry.attempt.status).toBe('SENT');
  });

  it('is idempotent for a completed send operation', async () => {
    const repository = new InMemoryNotificationRepository();
    await createNotification(repository);
    let sends = 0;
    const sender: NotificationSender = {
      async send() {
        sends += 1;
        return { providerReference: 'provider-1' };
      },
    };
    const useCase = new SendNotification(repository, sender);

    const first = await useCase.execute(customer, 'notification-1', 'send-key-1');
    const second = await useCase.execute(customer, 'notification-1', 'send-key-1');

    expect(sends).toBe(1);
    expect(second).toEqual(first);
  });

  it('cancels a queued notification without creating a delivery attempt', async () => {
    const repository = new InMemoryNotificationRepository();
    await createNotification(repository);
    const result = await new CancelNotification(repository).execute(customer, 'notification-1', 'cancel-key-1');

    expect(result.status).toBe('CANCELLED');
    await expect(new SendNotification(repository, senderReturning()).execute(customer, 'notification-1', 'send-key-1'))
      .rejects.toBeInstanceOf(ConflictError);
  });

  it('allows an administrator to operate on another users notification', async () => {
    const repository = new InMemoryNotificationRepository();
    await createNotification(repository);
    const result = await new SendNotification(repository, senderReturning()).execute(admin, 'notification-1', 'send-key-1');
    expect(result.notification.status).toBe('SENT');
  });

  it('rejects missing notifications', async () => {
    const repository = new InMemoryNotificationRepository();
    const get = new GetNotification(repository);
    await expect(get.execute(customer, 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects invalid idempotency keys', async () => {
    const repository = new InMemoryNotificationRepository();
    const create = new CreateNotification(repository);
    await expect(create.execute(customer, 'notification-1', customer.userId, 'IN_APP', 'x', payload(), ''))
      .rejects.toBeInstanceOf(Error);
  });

  it('rejects a repository concurrency conflict instead of silently overwriting state', async () => {
    const repository = new InMemoryNotificationRepository();
    await createNotification(repository);
    const notification = await repository.getById('notification-1');
    if (!notification) throw new Error('test setup failed');
    notification.cancel();

    await expect(repository.saveOperation(notification, 99, null, 'CANCEL', 'cancel-key-1'))
      .rejects.toBeInstanceOf(ConflictError);
  });
});
