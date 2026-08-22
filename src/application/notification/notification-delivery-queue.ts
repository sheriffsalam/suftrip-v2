import type { Notification } from '../../domain/notification/notification.js';

export type ClaimedNotification = Readonly<{
  notification: Notification;
  attemptId: string;
  attempts: number;
}>;

/**
 * Durable notification delivery queue boundary.
 *
 * The application owns delivery orchestration and domain transitions. The
 * infrastructure adapter owns PostgreSQL row locking, leases, and atomic
 * persistence of delivery attempts.
 */
export interface NotificationDeliveryQueue {
  claim(
    workerId: string,
    limit: number,
    leaseMs: number,
    maxAttempts: number,
    now?: Date,
  ): Promise<ClaimedNotification[]>;

  markSent(
    workerId: string,
    attemptId: string,
    notification: Notification,
    providerReference: string | null,
    now?: Date,
  ): Promise<boolean>;

  markFailed(
    workerId: string,
    attemptId: string,
    notification: Notification,
    now?: Date,
  ): Promise<boolean>;
}
