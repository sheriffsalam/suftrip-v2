import type { Notification } from '../../domain/notification/notification.js';

export type NotificationSendResult = Readonly<{
  providerReference: string | null;
}>;

export interface NotificationSender {
  send(notification: Notification, attemptId: string): Promise<NotificationSendResult>;
}
