import type { AuthenticatedPrincipal } from '../auth/authentication.js';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import {
  InvalidNotificationTransitionError,
  Notification,
  NotificationAttempt,
  type NotificationChannel,
  type NotificationPayload,
} from '../../domain/notification/notification.js';
import type { NotificationRepository, NotificationOperation } from './notification-repository.js';
import type { NotificationSender } from './notification-sender.js';

export type NotificationOperationResult = Readonly<{
  notification: ReturnType<Notification['snapshot']>;
  attempt: ReturnType<NotificationAttempt['snapshot']>;
}>;

export class CreateNotification {
  constructor(private readonly notifications: NotificationRepository) {}

  async execute(
    principal: AuthenticatedPrincipal,
    notificationId: string,
    recipientId: string,
    channel: NotificationChannel,
    templateKey: string,
    payload: NotificationPayload,
    idempotencyKey: string,
  ): Promise<ReturnType<Notification['snapshot']>> {
    requireIdempotencyKey(idempotencyKey);
    requireRecipientAccess(principal, recipientId);

    const existing = await this.notifications.findByCreationIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.snapshot().recipientId !== recipientId) throw new AuthorizationError();
      return existing.snapshot();
    }

    const notification = Notification.create(notificationId, recipientId, channel, templateKey, payload, idempotencyKey);
    await this.notifications.saveNew(notification, idempotencyKey);
    return notification.snapshot();
  }
}

export class GetNotification {
  constructor(private readonly notifications: NotificationRepository) {}

  async execute(principal: AuthenticatedPrincipal, notificationId: string): Promise<ReturnType<Notification['snapshot']>> {
    return (await getAuthorizedNotification(principal, notificationId, this.notifications)).snapshot();
  }
}

export class SendNotification {
  constructor(private readonly notifications: NotificationRepository, private readonly sender: NotificationSender) {}

  async execute(principal: AuthenticatedPrincipal, notificationId: string, idempotencyKey: string): Promise<NotificationOperationResult> {
    return deliver(principal, notificationId, idempotencyKey, 'SEND', this.notifications, this.sender);
  }
}

export class RetryNotification {
  constructor(private readonly notifications: NotificationRepository, private readonly sender: NotificationSender) {}

  async execute(principal: AuthenticatedPrincipal, notificationId: string, idempotencyKey: string): Promise<NotificationOperationResult> {
    return deliver(principal, notificationId, idempotencyKey, 'RETRY', this.notifications, this.sender);
  }
}

export class CancelNotification {
  constructor(private readonly notifications: NotificationRepository) {}

  async execute(
    principal: AuthenticatedPrincipal,
    notificationId: string,
    idempotencyKey: string,
  ): Promise<ReturnType<Notification['snapshot']>> {
    requireIdempotencyKey(idempotencyKey);
    const notification = await getAuthorizedNotification(principal, notificationId, this.notifications);
    if (await this.notifications.hasOperationIdempotencyKey(notificationId, 'CANCEL', idempotencyKey)) {
      return notification.snapshot();
    }

    const expectedVersion = notification.snapshot().version;
    notification.cancel();
    await this.notifications.saveOperation(notification, expectedVersion, null, 'CANCEL', idempotencyKey);
    return notification.snapshot();
  }
}

async function deliver(
  principal: AuthenticatedPrincipal,
  notificationId: string,
  idempotencyKey: string,
  operation: Extract<NotificationOperation, 'SEND' | 'RETRY'>,
  notifications: NotificationRepository,
  sender: NotificationSender,
): Promise<NotificationOperationResult> {
  requireIdempotencyKey(idempotencyKey);
  const notification = await getAuthorizedNotification(principal, notificationId, notifications);
  const existing = await notifications.findAttemptByIdempotencyKey(notificationId, operation, idempotencyKey);
  if (existing) {
    const current = await getAuthorizedNotification(principal, notificationId, notifications);
    return { notification: current.snapshot(), attempt: existing.snapshot() };
  }

  const expectedVersion = notification.snapshot().version;
  const attemptId = `${notificationId}-${operation.toLowerCase()}-${expectedVersion + 1}`;

  try {
    notification.beginProcessing(attemptId);
  } catch (error) {
    if (error instanceof InvalidNotificationTransitionError) {
      throw new ConflictError('Notification cannot be delivered in its current state');
    }
    throw error;
  }

  const attempt = NotificationAttempt.create(attemptId, notificationId);

  try {
    const result = await sender.send(notification, attemptId);
    notification.markSent(attemptId);
    const completedAttempt = attempt.withStatus('SENT', result.providerReference);
    await notifications.saveOperation(notification, expectedVersion, completedAttempt, operation, idempotencyKey);
    return { notification: notification.snapshot(), attempt: completedAttempt.snapshot() };
  } catch (error) {
    notification.markFailed(attemptId);
    const failedAttempt = attempt.withStatus('FAILED');
    await notifications.saveOperation(notification, expectedVersion, failedAttempt, operation, idempotencyKey);
    throw error;
  }
}

async function getAuthorizedNotification(
  principal: AuthenticatedPrincipal,
  notificationId: string,
  notifications: NotificationRepository,
): Promise<Notification> {
  const notification = await notifications.getById(notificationId);
  if (!notification) throw new NotFoundError(`Notification not found: ${notificationId}`);
  requireRecipientAccess(principal, notification.snapshot().recipientId);
  return notification;
}

function requireRecipientAccess(principal: AuthenticatedPrincipal, recipientId: string): void {
  if (principal.roles.includes('ADMIN')) return;
  if (principal.userId !== recipientId) throw new AuthorizationError();
}

function requireIdempotencyKey(value: string): void {
  if (!value.trim() || value.length > 255) {
    throw new ValidationError('Idempotency-Key is required and must be at most 255 characters');
  }
}
