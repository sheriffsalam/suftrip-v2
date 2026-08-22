import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

import type { AuthenticatedPrincipal, AuthenticationPort } from '../application/auth/authentication.js';
import {
  CancelNotification,
  CreateNotification,
  GetNotification,
  RetryNotification,
  SendNotification,
} from '../application/notification/notification-use-cases.js';
import type { NotificationChannel } from '../domain/notification/notification.js';
import { ApplicationError, AuthenticationError, ValidationError } from '../shared/errors.js';

export type NotificationHttpDependencies = Readonly<{
  create: CreateNotification;
  get: GetNotification;
  send: SendNotification;
  retry: RetryNotification;
  cancel: CancelNotification;
}>;

export type NotificationRouteResult = 'handled' | 'not-handled';

const CHANNELS: readonly NotificationChannel[] = ['IN_APP', 'PUSH', 'SMS', 'EMAIL'];

export async function handleNotificationRoute(
  request: IncomingMessage,
  response: ServerResponse,
  authenticator: AuthenticationPort,
  dependencies: NotificationHttpDependencies,
  requestId: string,
): Promise<NotificationRouteResult> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'notifications') {
    return 'not-handled';
  }

  const principal = authenticate(request, authenticator);
  const method = request.method ?? 'GET';

  if (method === 'POST' && parts.length === 3) {
    const body = await readJson(request);
    const idempotencyKey = requiredHeader(request, 'idempotency-key');

    if (typeof body.recipientId !== 'string' || !body.recipientId.trim()) {
      throw new ValidationError('recipientId is required');
    }
    if (typeof body.channel !== 'string' || !CHANNELS.includes(body.channel as NotificationChannel)) {
      throw new ValidationError(`channel must be one of: ${CHANNELS.join(', ')}`);
    }
    if (typeof body.templateKey !== 'string' || !body.templateKey.trim()) {
      throw new ValidationError('templateKey is required');
    }
    if (!isPayload(body.payload)) {
      throw new ValidationError('payload must be a JSON object');
    }

    const notificationId = typeof body.id === 'string' && body.id.trim() ? body.id : randomUUID();
    const notification = await dependencies.create.execute(
      principal,
      notificationId,
      body.recipientId,
      body.channel as NotificationChannel,
      body.templateKey,
      body.payload,
      idempotencyKey,
    );

    sendJson(response, 201, notification);
    return 'handled';
  }

  if (parts.length !== 4) return 'not-handled';

  const notificationId = decodeURIComponent(parts[3] ?? '');

  if (method === 'GET') {
    sendJson(response, 200, await dependencies.get.execute(principal, notificationId));
    return 'handled';
  }

  if (method !== 'POST') return 'not-handled';

  const action = parts[3] === 'send' || parts[3] === 'retry' || parts[3] === 'cancel'
    ? null
    : undefined;

  if (action === undefined) {
    const operation = parts[3];
    const id = decodeURIComponent(parts[3] ?? '');
    if (!id) return 'not-handled';
  }

  return 'not-handled';
}

function authenticate(
  request: IncomingMessage,
  authenticator: AuthenticationPort,
): AuthenticatedPrincipal {
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string') throw new AuthenticationError();

  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  if (!match?.[1]) {
    throw new AuthenticationError('Authorization must use Bearer authentication');
  }

  return authenticator.authenticate(match[1]);
}

function requiredHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${name} is required`);
  }
  return value.trim();
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;

  if (Number(request.headers['content-length'] ?? 0) > 1_048_576) {
    throw new ValidationError('Request body must not exceed 1 MB');
  }

  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_048_576) throw new ValidationError('Request body must not exceed 1 MB');
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError('Request body must be a JSON object');
  }

  return parsed as Record<string, unknown>;
}

function isPayload(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.setHeader('x-request-id', response.getHeader('x-request-id') ?? '');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('cache-control', 'no-store');
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

export function notificationErrorResponse(
  response: ServerResponse,
  error: unknown,
  requestId: string,
): void {
  const code = error instanceof ApplicationError ? error.code : 'INTERNAL_SERVER_ERROR';
  const message = error instanceof ApplicationError ? error.message : 'Internal server error';
  const status = code === 'NOT_FOUND' ? 404
    : code === 'AUTHENTICATION_ERROR' ? 401
      : code === 'AUTHORIZATION_ERROR' ? 403
        : code === 'CONFLICT' || code === 'IDEMPOTENCY_CONFLICT' ? 409
          : code === 'INVALID_TRANSITION' ? 422
            : error instanceof ApplicationError ? 400 : 500;

  response.setHeader('x-request-id', requestId);
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify({ error: { code, message, requestId } }));
}
