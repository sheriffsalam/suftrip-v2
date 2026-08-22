import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';

import type { AuthenticationPort } from '../application/auth/authentication.js';
import type { NotificationHttpDependencies } from './notification-routes.js';
import { handleNotificationRoute, notificationErrorResponse } from './notification-routes.js';

export function createNotificationHttpServer(
  authenticator: AuthenticationPort,
  dependencies: NotificationHttpDependencies,
): Server {
  return createServer((request, response) => {
    const supplied = request.headers['x-request-id'];
    const requestId = typeof supplied === 'string' && supplied.trim()
      ? supplied.trim().slice(0, 128)
      : randomUUID();

    response.setHeader('x-request-id', requestId);

    handleNotificationRoute(request, response, authenticator, dependencies, requestId)
      .then(result => {
        if (result === 'not-handled' && !response.writableEnded) {
          notificationErrorResponse(
            response,
            new Error('Route not found'),
            requestId,
          );
        }
      })
      .catch(error => {
        if (!response.writableEnded) notificationErrorResponse(response, error, requestId);
      });
  });
}
