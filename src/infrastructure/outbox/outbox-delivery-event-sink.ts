import type { DeliveryEvent } from '../../domain/delivery/delivery-job.js';
import type { OutboxWorker } from '../../application/outbox/outbox-publisher.js';
import type { DeliveryEventSink } from '../../application/delivery/delivery-event-sink.js';

export class OutboxDeliveryEventSink implements DeliveryEventSink {
  constructor(private readonly worker: OutboxWorker) {}

  async publish(_events: readonly DeliveryEvent[]): Promise<void> {
    await this.worker.processOnce();
  }
}
