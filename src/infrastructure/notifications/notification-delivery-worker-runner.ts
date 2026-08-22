import type { Logger } from '../../application/observability/logger.js';
import type { NotificationDeliveryWorker } from '../../application/notification/notification-delivery-worker.js';

export type NotificationDeliveryWorkerRunnerOptions = Readonly<{
  pollIntervalMs?: number;
  logger?: Logger;
}>;

/** Owns the long-running process lifecycle for notification delivery polling. */
export class NotificationDeliveryWorkerRunner {
  private readonly pollIntervalMs: number;
  private readonly logger: Logger | undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private pollInFlight = false;

  constructor(
    private readonly worker: NotificationDeliveryWorker,
    options: NotificationDeliveryWorkerRunnerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    if (!Number.isInteger(this.pollIntervalMs) || this.pollIntervalMs < 1) {
      throw new Error('pollIntervalMs must be a positive integer');
    }
    this.logger = options.logger;
  }

  isRunning(): boolean {
    return this.running;
  }

  async runOnce(): Promise<number> {
    if (this.pollInFlight) return 0;
    this.pollInFlight = true;
    try {
      return await this.worker.processOnce();
    } finally {
      this.pollInFlight = false;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    try {
      await this.runOnce();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown notification worker failure';
      this.logger?.error('notification.worker.poll_failed', { error: message.slice(0, 500) });
    } finally {
      if (this.running) {
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.poll();
        }, this.pollIntervalMs);
      }
    }
  }
}
