import type { DeliveryEvent } from '../../domain/delivery/delivery-job.js';

export interface DeliveryEventSink {
  publish(events: readonly DeliveryEvent[]): Promise<void>;
}
