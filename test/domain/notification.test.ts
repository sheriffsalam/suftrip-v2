import { describe, expect, it } from 'vitest';

import {
  InvalidNotificationTransitionError,
  Notification,
  NotificationAttempt,
} from '../../src/domain/notification/notification.js';

describe('Notification', () => {
  it('creates a queued notification and emits a creation event', () => {
    const notification = Notification.create(
      'notification-1',
      'user-1',
      'IN_APP',
      'delivery.status.changed',
      { deliveryJobId: 'delivery-1', status: 'DELIVERED' },
      'notification-key-1',
    );

    expect(notification.snapshot()).toMatchObject({
      id: 'notification-1',
      recipientId: 'user-1',
      channel: 'IN_APP',
      templateKey: 'delivery.status.changed',
      status: 'QUEUED',
      version: 0,
    });
    expect(notification.pullEvents()).toEqual([
      { type: 'NotificationCreated', notificationId: 'notification-1' },
    ]);
  });

  it('supports processing, sending, and failure retry', () => {
    const notification = Notification.create(
      'notification-2',
      'user-2',
      'PUSH',
      'payment.succeeded',
      { paymentId: 'payment-1' },
      'notification-key-2',
    );
    notification.pullEvents();

    notification.beginProcessing('attempt-1');
    notification.markFailed('attempt-1');
    notification.beginProcessing('attempt-2');
    notification.markSent('attempt-2');

    expect(notification.snapshot().status).toBe('SENT');
    expect(notification.snapshot().version).toBe(4);
    expect(notification.pullEvents()).toEqual([
      {
        type: 'NotificationProcessingStarted',
        notificationId: 'notification-2',
        attemptId: 'attempt-1',
      },
      {
        type: 'NotificationFailed',
        notificationId: 'notification-2',
        attemptId: 'attempt-1',
      },
      {
        type: 'NotificationProcessingStarted',
        notificationId: 'notification-2',
        attemptId: 'attempt-2',
      },
      {
        type: 'NotificationSent',
        notificationId: 'notification-2',
        attemptId: 'attempt-2',
      },
    ]);
  });

  it('supports cancellation and rejects invalid transitions', () => {
    const notification = Notification.create(
      'notification-3',
      'user-3',
      'SMS',
      'delivery.created',
      {},
      'notification-key-3',
    );
    notification.pullEvents();

    notification.cancel();
    expect(notification.snapshot().status).toBe('CANCELLED');
    expect(() => notification.cancel()).toThrow(InvalidNotificationTransitionError);
    expect(() => notification.markSent('attempt-3')).toThrow(
      InvalidNotificationTransitionError,
    );
  });

  it('rehydrates persisted state without emitting a creation event', () => {
    const created = Notification.create(
      'notification-4',
      'user-4',
      'EMAIL',
      'welcome',
      { name: 'Sheriff' },
      'notification-key-4',
    );
    created.beginProcessing('attempt-4');

    const rehydrated = Notification.rehydrate(created.snapshot());

    expect(rehydrated.snapshot()).toEqual(created.snapshot());
    expect(rehydrated.pullEvents()).toEqual([]);
  });

  it('validates identifiers, channel, and payload', () => {
    expect(() =>
      Notification.create('', 'user-1', 'IN_APP', 'template', {}, 'key'),
    ).toThrow('Notification id is required');
    expect(() =>
      Notification.create('id', 'user-1', 'INVALID' as never, 'template', {}, 'key'),
    ).toThrow('Invalid notification channel');
    expect(() =>
      Notification.create('id', 'user-1', 'IN_APP', 'template', [] as never, 'key'),
    ).toThrow('Notification payload must be an object');
  });
});

describe('NotificationAttempt', () => {
  it('creates, rehydrates, and updates an attempt', () => {
    const attempt = NotificationAttempt.create('attempt-1', 'notification-1');
    expect(attempt.snapshot().status).toBe('PROCESSING');

    const sent = attempt.withStatus('SENT', 'provider-1');
    expect(sent.snapshot()).toMatchObject({
      id: 'attempt-1',
      notificationId: 'notification-1',
      status: 'SENT',
      providerReference: 'provider-1',
    });

    const rehydrated = NotificationAttempt.rehydrate(sent.snapshot());
    expect(rehydrated.snapshot()).toEqual(sent.snapshot());
  });
});
