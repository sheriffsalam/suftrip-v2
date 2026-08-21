import {
  ConflictError,
  IdempotencyConflictError,
} from '../../shared/errors.js';
import {
  Notification,
  NotificationAttempt,
  type NotificationAttemptSnapshot,
} from '../../domain/notification/notification.js';
import type {
  NotificationOperation,
  NotificationRepository,
} from './notification-repository.js';

export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly notifications = new Map<string, ReturnType<Notification['snapshot']>>();
  private readonly attempts = new Map<string, NotificationAttemptSnapshot>();
  private readonly creationKeys = new Map<string, string>();
  private readonly operationKeys = new Map<string, string>();

  async getById(id: string): Promise<Notification | null> {
    const record = this.notifications.get(id);
    return record ? Notification.rehydrate(record) : null;
  }

  async findByCreationIdempotencyKey(idempotencyKey: string): Promise<Notification | null> {
    const notificationId = this.creationKeys.get(idempotencyKey);
    return notificationId ? this.getById(notificationId) : null;
  }

  async findAttemptByIdempotencyKey(
    notificationId: string,
    operation: NotificationOperation,
    idempotencyKey: string,
  ): Promise<NotificationAttempt | null> {
    const attemptId = this.operationKeys.get(this.operationKey(notificationId, operation, idempotencyKey));
    const record = attemptId ? this.attempts.get(attemptId) : undefined;
    return record ? NotificationAttempt.rehydrate(record) : null;
  }

  async hasOperationIdempotencyKey(
    notificationId: string,
    operation: NotificationOperation,
    idempotencyKey: string,
  ): Promise<boolean> {
    return this.operationKeys.has(this.operationKey(notificationId, operation, idempotencyKey));
  }

  async getAttemptById(id: string): Promise<NotificationAttempt | null> {
    const record = this.attempts.get(id);
    return record ? NotificationAttempt.rehydrate(record) : null;
  }

  async saveNew(notification: Notification, idempotencyKey: string): Promise<void> {
    if (this.notifications.has(notification.snapshot().id)) {
      throw new ConflictError('Notification already exists');
    }
    if (this.creationKeys.has(idempotencyKey)) {
      throw new IdempotencyConflictError();
    }
    this.notifications.set(notification.snapshot().id, notification.snapshot());
    this.creationKeys.set(idempotencyKey, notification.snapshot().id);
  }

  async saveOperation(
    notification: Notification,
    expectedVersion: number,
    attempt: NotificationAttempt | null,
    operation: NotificationOperation,
    idempotencyKey: string,
  ): Promise<void> {
    const current = this.notifications.get(notification.snapshot().id);
    if (!current || current.version !== expectedVersion) {
      throw new ConflictError('Notification concurrency conflict');
    }

    const operationKey = this.operationKey(notification.snapshot().id, operation, idempotencyKey);
    if (this.operationKeys.has(operationKey)) {
      throw new IdempotencyConflictError();
    }
    if (attempt && this.attempts.has(attempt.snapshot().id)) {
      throw new ConflictError('Notification attempt already exists');
    }

    this.notifications.set(notification.snapshot().id, notification.snapshot());
    if (attempt) this.attempts.set(attempt.snapshot().id, attempt.snapshot());
    this.operationKeys.set(operationKey, attempt?.snapshot().id ?? notification.snapshot().id);
  }

  private operationKey(
    notificationId: string,
    operation: NotificationOperation,
    idempotencyKey: string,
  ): string {
    return `${notificationId}:${operation}:${idempotencyKey}`;
  }
}
