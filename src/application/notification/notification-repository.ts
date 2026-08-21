import type {
  Notification,
  NotificationAttempt,
  NotificationAttemptSnapshot,
} from '../../domain/notification/notification.js';

export type NotificationOperation = 'SEND' | 'RETRY' | 'CANCEL';

export interface NotificationRepository {
  getById(id: string): Promise<Notification | null>;
  findByCreationIdempotencyKey(idempotencyKey: string): Promise<Notification | null>;
  findAttemptByIdempotencyKey(
    notificationId: string,
    operation: NotificationOperation,
    idempotencyKey: string,
  ): Promise<NotificationAttempt | null>;
  hasOperationIdempotencyKey(
    notificationId: string,
    operation: NotificationOperation,
    idempotencyKey: string,
  ): Promise<boolean>;
  getAttemptById(id: string): Promise<NotificationAttempt | null>;
  saveNew(notification: Notification, idempotencyKey: string): Promise<void>;
  saveOperation(
    notification: Notification,
    expectedVersion: number,
    attempt: NotificationAttempt | null,
    operation: NotificationOperation,
    idempotencyKey: string,
  ): Promise<void>;
}

export type NotificationRecord = ReturnType<Notification['snapshot']>;
export type NotificationAttemptRecord = NotificationAttemptSnapshot;
