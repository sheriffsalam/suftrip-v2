import type { Notification } from '../../domain/notification/notification.js';
import type {
  NotificationSendResult,
  NotificationSender,
} from '../../application/notification/notification-sender.js';

export class DeterministicNotificationSender implements NotificationSender {
  async send(_notification: Notification, attemptId: string): Promise<NotificationSendResult> {
    return { providerReference: `internal-notification-${attemptId}` };
  }
}
