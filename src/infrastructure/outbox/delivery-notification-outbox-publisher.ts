import type { OutboxEventPublisher } from '../../application/outbox/outbox-publisher.js';
import type { OutboxEvent } from '../../application/outbox/outbox-event.js';
import type { DeliveryJobRepository } from '../../application/delivery/delivery-job-repository.js';
import type { AuthenticatedPrincipal } from '../../application/auth/authentication.js';
import { CreateNotification } from '../../application/notification/notification-use-cases.js';

const SYSTEM_PRINCIPAL: AuthenticatedPrincipal = { userId: 'system', roles: ['ADMIN'] };

type DeliveryStatusEvent = Readonly<{
  type: 'DeliveryJobStatusChanged';
  deliveryJobId: string;
  from: string;
  to: string;
}>;

function isDeliveryStatusEvent(payload: Record<string, unknown>): payload is DeliveryStatusEvent {
  return payload.type === 'DeliveryJobStatusChanged'
    && typeof payload.deliveryJobId === 'string'
    && typeof payload.from === 'string'
    && typeof payload.to === 'string';
}

export class DeliveryNotificationOutboxPublisher implements OutboxEventPublisher {
  constructor(
    private readonly deliveries: DeliveryJobRepository,
    private readonly createNotification: CreateNotification,
  ) {}

  async publish(event: OutboxEvent): Promise<void> {
    if (event.type !== 'DeliveryJobStatusChanged' || !isDeliveryStatusEvent(event.payload)) {
      throw new Error(`Unsupported outbox event type: ${event.type}`);
    }

    const delivery = await this.deliveries.getById(event.aggregateId);
    if (!delivery) throw new Error(`DeliveryJob not found for outbox event: ${event.aggregateId}`);
    const snapshot = delivery.snapshot();

    await this.createNotification.execute(
      SYSTEM_PRINCIPAL,
      `delivery-status-${event.aggregateId}-${event.payload.to}`,
      snapshot.requesterId,
      'IN_APP',
      'delivery.status.updated',
      {
        deliveryId: snapshot.id,
        from: event.payload.from,
        to: event.payload.to,
        deliveryType: snapshot.deliveryType,
      },
      `delivery-status:${event.aggregateId}:${event.payload.from}:${event.payload.to}`,
    );
  }
}
