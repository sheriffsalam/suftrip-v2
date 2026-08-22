import type { AuthenticatedPrincipal } from '../auth/authentication.js';
import type { DeliveryJobRepository } from '../delivery/delivery-job-repository.js';
import type { DeliveryEvent } from '../../domain/delivery/delivery-job.js';
import { CreateNotification } from './notification-use-cases.js';

const SYSTEM_PRINCIPAL: AuthenticatedPrincipal = {
  userId: 'system',
  roles: ['ADMIN'],
};

export class DeliveryNotificationEventSink {
  constructor(
    private readonly deliveries: DeliveryJobRepository,
    private readonly createNotification: CreateNotification,
  ) {}

  async publish(events: readonly DeliveryEvent[]): Promise<void> {
    for (const event of events) {
      const delivery = await this.deliveries.getById(event.deliveryJobId);
      if (!delivery) continue;

      const snapshot = delivery.snapshot();
      const notificationId = `delivery-status-${event.deliveryJobId}-${event.to}`;
      const idempotencyKey = `delivery-status:${event.deliveryJobId}:${event.from}:${event.to}`;

      await this.createNotification.execute(
        SYSTEM_PRINCIPAL,
        notificationId,
        snapshot.requesterId,
        'IN_APP',
        'delivery.status.updated',
        {
          deliveryId: snapshot.id,
          from: event.from,
          to: event.to,
          deliveryType: snapshot.deliveryType,
        },
        idempotencyKey,
      );
    }
  }
}
