import {
  InvalidTransitionError,
  ValidationError,
} from '../../shared/errors.js';

export const NOTIFICATION_CHANNELS = [
  'IN_APP',
  'PUSH',
  'SMS',
  'EMAIL',
] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = [
  'QUEUED',
  'PROCESSING',
  'SENT',
  'FAILED',
  'CANCELLED',
] as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const NOTIFICATION_ATTEMPT_STATUSES = [
  'PROCESSING',
  'SENT',
  'FAILED',
] as const;

export type NotificationAttemptStatus =
  (typeof NOTIFICATION_ATTEMPT_STATUSES)[number];

export type NotificationPayload = Readonly<Record<string, unknown>>;

export type NotificationSnapshot = Readonly<{
  id: string;
  recipientId: string;
  channel: NotificationChannel;
  templateKey: string;
  payload: NotificationPayload;
  idempotencyKey: string;
  status: NotificationStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type NotificationAttemptSnapshot = Readonly<{
  id: string;
  notificationId: string;
  status: NotificationAttemptStatus;
  providerReference: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type NotificationEvent =
  | Readonly<{ type: 'NotificationCreated'; notificationId: string }>
  | Readonly<{
      type: 'NotificationProcessingStarted';
      notificationId: string;
      attemptId: string;
    }>
  | Readonly<{
      type: 'NotificationSent';
      notificationId: string;
      attemptId: string;
    }>
  | Readonly<{
      type: 'NotificationFailed';
      notificationId: string;
      attemptId: string;
    }>
  | Readonly<{ type: 'NotificationCancelled'; notificationId: string }>;

const TRANSITIONS: Readonly<
  Record<NotificationStatus, readonly NotificationStatus[]>
> = {
  QUEUED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SENT', 'FAILED', 'CANCELLED'],
  SENT: [],
  FAILED: ['PROCESSING'],
  CANCELLED: [],
};

export class InvalidNotificationTransitionError extends InvalidTransitionError {}

export class Notification {
  private readonly events: NotificationEvent[] = [];

  private constructor(private state: NotificationSnapshot) {}

  static create(
    id: string,
    recipientId: string,
    channel: NotificationChannel,
    templateKey: string,
    payload: NotificationPayload,
    idempotencyKey: string,
  ): Notification {
    validateNotificationInput(
      id,
      recipientId,
      channel,
      templateKey,
      payload,
      idempotencyKey,
    );

    const now = new Date().toISOString();
    const notification = new Notification({
      id,
      recipientId,
      channel,
      templateKey,
      payload,
      idempotencyKey,
      status: 'QUEUED',
      version: 0,
      createdAt: now,
      updatedAt: now,
    });

    notification.events.push({
      type: 'NotificationCreated',
      notificationId: id,
    });

    return notification;
  }

  static rehydrate(snapshot: NotificationSnapshot): Notification {
    validateNotificationInput(
      snapshot.id,
      snapshot.recipientId,
      snapshot.channel,
      snapshot.templateKey,
      snapshot.payload,
      snapshot.idempotencyKey,
    );

    if (!NOTIFICATION_STATUSES.includes(snapshot.status)) {
      throw new ValidationError(
        `Invalid notification status: ${String(snapshot.status)}`,
      );
    }

    if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 0) {
      throw new ValidationError(
        'Notification version must be a non-negative safe integer',
      );
    }

    return new Notification(snapshot);
  }

  beginProcessing(attemptId: string): void {
    validateId(attemptId, 'Notification attempt id');
    this.transitionTo('PROCESSING');
    this.events.push({
      type: 'NotificationProcessingStarted',
      notificationId: this.state.id,
      attemptId,
    });
  }

  markSent(attemptId: string): void {
    validateId(attemptId, 'Notification attempt id');
    this.transitionTo('SENT');
    this.events.push({
      type: 'NotificationSent',
      notificationId: this.state.id,
      attemptId,
    });
  }

  markFailed(attemptId: string): void {
    validateId(attemptId, 'Notification attempt id');
    this.transitionTo('FAILED');
    this.events.push({
      type: 'NotificationFailed',
      notificationId: this.state.id,
      attemptId,
    });
  }

  cancel(): void {
    this.transitionTo('CANCELLED');
    this.events.push({
      type: 'NotificationCancelled',
      notificationId: this.state.id,
    });
  }

  transitionTo(next: NotificationStatus): void {
    if (!TRANSITIONS[this.state.status].includes(next)) {
      throw new InvalidNotificationTransitionError(
        `Invalid Notification transition: ${this.state.status} -> ${next}`,
      );
    }

    this.state = {
      ...this.state,
      status: next,
      version: this.state.version + 1,
      updatedAt: new Date().toISOString(),
    };
  }

  snapshot(): NotificationSnapshot {
    return this.state;
  }

  pullEvents(): readonly NotificationEvent[] {
    return this.events.splice(0);
  }
}

export class NotificationAttempt {
  private constructor(private readonly state: NotificationAttemptSnapshot) {}

  static create(
    id: string,
    notificationId: string,
    providerReference: string | null = null,
  ): NotificationAttempt {
    validateId(id, 'Notification attempt id');
    validateId(notificationId, 'Notification id');

    const now = new Date().toISOString();
    return new NotificationAttempt({
      id,
      notificationId,
      status: 'PROCESSING',
      providerReference,
      createdAt: now,
      updatedAt: now,
    });
  }

  static rehydrate(snapshot: NotificationAttemptSnapshot): NotificationAttempt {
    validateId(snapshot.id, 'Notification attempt id');
    validateId(snapshot.notificationId, 'Notification id');

    if (!NOTIFICATION_ATTEMPT_STATUSES.includes(snapshot.status)) {
      throw new ValidationError(
        `Invalid notification attempt status: ${String(snapshot.status)}`,
      );
    }

    return new NotificationAttempt(snapshot);
  }

  withStatus(
    status: NotificationAttemptStatus,
    providerReference = this.state.providerReference,
  ): NotificationAttempt {
    return new NotificationAttempt({
      ...this.state,
      status,
      providerReference,
      updatedAt: new Date().toISOString(),
    });
  }

  snapshot(): NotificationAttemptSnapshot {
    return this.state;
  }
}

function validateNotificationInput(
  id: string,
  recipientId: string,
  channel: NotificationChannel,
  templateKey: string,
  payload: NotificationPayload,
  idempotencyKey: string,
): void {
  validateId(id, 'Notification id');
  validateId(recipientId, 'Notification recipientId');
  validateId(templateKey, 'Notification templateKey');
  validateId(idempotencyKey, 'Notification idempotencyKey');

  if (!NOTIFICATION_CHANNELS.includes(channel)) {
    throw new ValidationError(`Invalid notification channel: ${String(channel)}`);
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ValidationError('Notification payload must be an object');
  }
}

function validateId(value: string, name: string): void {
  if (!value.trim()) {
    throw new ValidationError(`${name} is required`);
  }
}
