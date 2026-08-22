import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  DELIVERY_TYPES,
  type DeliveryStatus,
  type DeliveryType,
} from '../domain/delivery/delivery-job.js';
import { DeliveryService } from '../application/delivery/delivery-service.js';
import type { AuthenticatedPrincipal, AuthenticationPort } from '../application/auth/authentication.js';
import { PostgresDeliveryJobRepository } from '../infrastructure/persistence/postgres/postgres-delivery-job-repository.js';
import { createPostgresPool } from '../infrastructure/persistence/postgres/postgres-client.js';
import { createAuthenticatorFromEnvironment } from '../infrastructure/auth/signed-bearer-token-authenticator.js';
import { PostgresDispatchJobRepository } from '../infrastructure/persistence/postgres/postgres-dispatch-repository.js';
import { PostgresProviderRepository } from '../infrastructure/persistence/postgres/postgres-provider-repository.js';
import { CreateDispatchJob } from '../application/dispatch/create-dispatch-job.js';
import { AssignProvider } from '../application/dispatch/assign-provider.js';
import { DispatchActions } from '../application/dispatch/dispatch-actions.js';
import { CreateProvider } from '../application/dispatch/create-provider.js';
import { CancelPayment, ConfirmPayment, CreatePayment, FailPayment, GetPayment, InitiatePayment } from '../application/payment/payment-use-cases.js';
import type { PaymentOperationResult } from '../application/payment/payment-use-cases.js';
import { PostgresPaymentRepository } from '../infrastructure/persistence/postgres/postgres-payment-repository.js';
import { DeterministicPaymentGateway } from '../infrastructure/payments/deterministic-payment-gateway.js';
import { CancelNotification, CreateNotification, GetNotification, RetryNotification, SendNotification } from '../application/notification/notification-use-cases.js';
import { DeliveryNotificationEventSink } from '../application/notification/delivery-notification-event-sink.js';
import { PostgresNotificationRepository } from '../infrastructure/persistence/postgres/postgres-notification-repository.js';
import { DeterministicNotificationSender } from '../infrastructure/notifications/deterministic-notification-sender.js';
import { handleNotificationRoute, type NotificationHttpDependencies } from './notification-routes.js';
import { ApplicationError, AuthenticationError, ValidationError } from '../shared/errors.js';

export type DispatchHttpDependencies = Readonly<{
  createDispatch: CreateDispatchJob;
  assignProvider: AssignProvider;
  actions: DispatchActions;
  createProvider: CreateProvider;
}>;

export type PaymentHttpDependencies = Readonly<{
  create: CreatePayment;
  get: GetPayment;
  initiate: InitiatePayment;
  confirm: ConfirmPayment;
  fail: FailPayment;
  cancel: CancelPayment;
}>;

const PORT = Number(process.env.PORT ?? 3000);

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('cache-control', 'no-store');
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, statusCode: number, code: string, message: string, requestId: string): void {
  sendJson(response, statusCode, { error: { code, message, requestId } });
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  if (Number(request.headers['content-length'] ?? 0) > 1_048_576) throw new ValidationError('Request body must not exceed 1 MB');
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_048_576) throw new ValidationError('Request body must not exceed 1 MB');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ValidationError('Request body must be valid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ValidationError('Request body must be a JSON object');
  return parsed as Record<string, unknown>;
}

function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return typeof value === 'string' && ['DRAFT','REQUESTED','QUOTING','BOOKED','SEARCHING_FOR_PROVIDER','PROVIDER_ASSIGNED','PROVIDER_ACCEPTED','ARRIVING_FOR_PICKUP','PICKED_UP','IN_TRANSIT','ARRIVING','DELIVERED','CANCELLED'].includes(value);
}
function isDeliveryType(value: unknown): value is DeliveryType {
  return typeof value === 'string' && DELIVERY_TYPES.includes(value as DeliveryType);
}
function isLocation(value: unknown): value is { address: string; latitude: number; longitude: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const location = value as Record<string, unknown>;
  return typeof location.address === 'string' && Number.isFinite(location.latitude) && Number.isFinite(location.longitude);
}
function isProviderLocation(value: unknown): value is { latitude: number; longitude: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const location = value as Record<string, unknown>;
  return Number.isFinite(location.latitude) && Number.isFinite(location.longitude);
}
function requestIdFor(request: IncomingMessage): string {
  const supplied = request.headers['x-request-id'];
  return typeof supplied === 'string' && supplied.trim() ? supplied.trim().slice(0, 128) : randomUUID();
}
function authenticateRequest(request: IncomingMessage, authenticator: AuthenticationPort): AuthenticatedPrincipal {
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string') throw new AuthenticationError();
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  if (!match?.[1]) throw new AuthenticationError('Authorization must use Bearer authentication');
  return authenticator.authenticate(match[1]);
}
function deliveryJobResponse(job: Awaited<ReturnType<DeliveryService['get']>>): unknown {
  if (!job) return job;
  return { id: job.id, requesterId: job.requesterId, pickup: job.pickup, dropoff: job.dropoff, deliveryType: job.deliveryType, status: job.status, version: job.version, createdAt: job.createdAt, updatedAt: job.updatedAt };
}
function dispatchJobResponse(job: Awaited<ReturnType<DispatchActions['get']>>): unknown {
  return { id: job.id, deliveryJobId: job.deliveryJobId, status: job.status, assignedProviderId: job.assignedProviderId, attempt: job.attempt, version: job.version, createdAt: job.createdAt, updatedAt: job.updatedAt };
}
function paymentResponse(payment: Awaited<ReturnType<GetPayment['execute']>>): unknown {
  return { id: payment.id, deliveryJobId: payment.deliveryJobId, amountMinor: payment.amountMinor, currency: payment.currency, status: payment.status, version: payment.version, createdAt: payment.createdAt, updatedAt: payment.updatedAt };
}
function paymentOperationResponse(result: PaymentOperationResult): unknown { return { payment: paymentResponse(result.payment), attempt: result.attempt }; }

async function handle(request: IncomingMessage, response: ServerResponse, service: DeliveryService, requestId: string, authenticator: AuthenticationPort, dispatch: DispatchHttpDependencies | undefined, payments: PaymentHttpDependencies | undefined, notifications: NotificationHttpDependencies | undefined): Promise<void> {
  response.setHeader('x-request-id', requestId);
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);
  if (method === 'GET' && url.pathname === '/health') { sendJson(response, 200, { status: 'ok', service: 'suftrip-v2' }); return; }
  if (notifications && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'notifications') {
    const result = await handleNotificationRoute(request, response, authenticator, notifications, requestId);
    if (result === 'handled') return;
  }
  const isDeliveryApi = parts[0] === 'api' && parts[1] === 'v1';
  const principal = isDeliveryApi ? authenticateRequest(request, authenticator) : undefined;
  if (payments && principal && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'delivery-jobs' && parts.length === 5 && parts[4] === 'payments' && method === 'POST') {
    const body = await readJson(request); const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || typeof body.amountMinor !== 'number' || typeof body.currency !== 'string') throw new ValidationError('Idempotency-Key, amountMinor, and currency are required');
    const paymentId = typeof body.id === 'string' && body.id.trim() ? body.id : randomUUID();
    const payment = await payments.create.execute(principal, paymentId, decodeURIComponent(parts[3] ?? ''), body.amountMinor, body.currency, idempotencyKey);
    sendJson(response, 201, paymentResponse(payment)); return;
  }
  if (payments && principal && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'payments' && parts.length === 4 && method === 'GET') { sendJson(response, 200, paymentResponse(await payments.get.execute(principal, decodeURIComponent(parts[3] ?? '')))); return; }
  if (payments && principal && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'payments' && parts.length === 5 && ['initiate','confirm','fail','cancel'].includes(parts[4] ?? '') && method === 'POST') {
    const paymentId = decodeURIComponent(parts[3] ?? ''); const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) throw new ValidationError('Idempotency-Key is required');
    const body = await readJson(request); const attemptId = typeof body.attemptId === 'string' ? body.attemptId : undefined; const action = parts[4];
    if (action === 'initiate') { sendJson(response, 200, paymentOperationResponse(await payments.initiate.execute(principal, paymentId, idempotencyKey))); return; }
    if (action === 'confirm') { sendJson(response, 200, paymentOperationResponse(await payments.confirm.execute(principal, paymentId, idempotencyKey, attemptId))); return; }
    if (action === 'fail') { sendJson(response, 200, paymentOperationResponse(await payments.fail.execute(principal, paymentId, idempotencyKey, attemptId))); return; }
    if (action === 'cancel') { sendJson(response, 200, paymentOperationResponse(await payments.cancel.execute(principal, paymentId, idempotencyKey))); return; }
  }
  if (dispatch && principal && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'delivery-jobs' && parts.length === 5 && parts[4] === 'dispatch' && method === 'POST') {
    const body = await readJson(request); const dispatchJobId = typeof body.id === 'string' && body.id.trim() ? body.id : randomUUID();
    sendJson(response, 201, dispatchJobResponse(await dispatch.createDispatch.execute(principal, dispatchJobId, decodeURIComponent(parts[3] ?? '')))); return;
  }
  if (dispatch && principal && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'dispatch-jobs' && parts.length === 4 && method === 'GET') { sendJson(response, 200, dispatchJobResponse(await dispatch.actions.get(principal, decodeURIComponent(parts[3] ?? '')))); return; }
  if (dispatch && principal && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'dispatch-jobs' && parts.length === 5 && method === 'POST') {
    const dispatchJobId = decodeURIComponent(parts[3] ?? ''); const action = parts[4]; const body = await readJson(request);
    if (action === 'assign') { const providerId = typeof body.providerId === 'string' ? body.providerId : undefined; sendJson(response, 200, dispatchJobResponse(await dispatch.assignProvider.execute(principal, dispatchJobId, providerId))); return; }
    const providerId = typeof body.providerId === 'string' ? body.providerId : principal.userId;
    const job = action === 'accept' ? await dispatch.actions.accept(principal, dispatchJobId, providerId) : action === 'reject' ? await dispatch.actions.reject(principal, dispatchJobId, providerId) : action === 'cancel' ? await dispatch.actions.cancel(principal, dispatchJobId) : null;
    if (job) { sendJson(response, 200, dispatchJobResponse(job)); return; }
  }
  if (dispatch && principal && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'providers' && parts.length === 3 && method === 'POST') {
    const body = await readJson(request); const availability = body.availability;
    if (typeof body.id !== 'string' || !body.id.trim() || !['OFFLINE','AVAILABLE','BUSY','SUSPENDED'].includes(String(availability)) || !isProviderLocation(body.location)) throw new ValidationError('Provider id, availability, and location are required');
    sendJson(response, 201, await dispatch.createProvider.execute(principal, { id: body.id, availability: availability as 'OFFLINE' | 'AVAILABLE' | 'BUSY' | 'SUSPENDED', location: body.location })); return;
  }
  if (method === 'POST' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'delivery-jobs') {
    const body = await readJson(request); const pickup = body.pickup; const dropoff = body.dropoff;
    if (!isLocation(pickup) || !isLocation(dropoff) || !isDeliveryType(body.deliveryType)) throw new ValidationError('pickup, dropoff, and deliveryType are required');
    const job = await service.create(principal!, { id: typeof body.id === 'string' && body.id.trim() ? body.id : randomUUID(), requesterId: principal!.userId, pickup, dropoff, deliveryType: body.deliveryType });
    sendJson(response, 201, deliveryJobResponse(job)); return;
  }
  if (method === 'GET' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'delivery-jobs') {
    const job = await service.get(principal!, decodeURIComponent(parts[3] ?? ''));
    if (!job) { sendError(response, 404, 'DELIVERY_JOB_NOT_FOUND', 'Delivery job was not found', requestId); return; }
    sendJson(response, 200, deliveryJobResponse(job)); return;
  }
  if (method === 'PATCH' && parts.length === 5 && parts[4] === 'status' && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'delivery-jobs') {
    const body = await readJson(request); const expectedVersion = body.expectedVersion; const nextStatus = body.nextStatus;
    if (!Number.isInteger(expectedVersion) || !isDeliveryStatus(nextStatus)) throw new ValidationError('expectedVersion and nextStatus are required');
    sendJson(response, 200, deliveryJobResponse(await service.changeStatus(principal!, decodeURIComponent(parts[3] ?? ''), expectedVersion as number, nextStatus))); return;
  }
  sendError(response, 404, 'ROUTE_NOT_FOUND', 'Route not found', requestId);
}

function errorResponse(response: ServerResponse, error: unknown, requestId: string): void {
  if (error instanceof ApplicationError) {
    const statusCode = error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' || error.code === 'IDEMPOTENCY_CONFLICT' ? 409 : error.code === 'INVALID_TRANSITION' ? 422 : error.code === 'AUTHENTICATION_ERROR' ? 401 : error.code === 'AUTHORIZATION_ERROR' ? 403 : 400;
    sendError(response, statusCode, error.code, error.message, requestId); return;
  }
  sendError(response, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error', requestId);
}

export function createHttpServer(service?: DeliveryService, authenticator?: AuthenticationPort, dispatchDependencies?: DispatchHttpDependencies, paymentDependencies?: PaymentHttpDependencies, notificationDependencies?: NotificationHttpDependencies) {
  const pool = service || dispatchDependencies || paymentDependencies || notificationDependencies ? undefined : createPostgresPool();
  const deliveryRepository = pool ? new PostgresDeliveryJobRepository(pool) : undefined;
  const selectedNotifications = notificationDependencies ?? (pool ? (() => {
    const notificationRepository = new PostgresNotificationRepository(pool);
    const sender = new DeterministicNotificationSender();
    return { create: new CreateNotification(notificationRepository), get: new GetNotification(notificationRepository), send: new SendNotification(notificationRepository, sender), retry: new RetryNotification(notificationRepository, sender), cancel: new CancelNotification(notificationRepository) };
  })() : undefined);
  const selectedService = service ?? new DeliveryService(
    deliveryRepository!,
    selectedNotifications && deliveryRepository
      ? new DeliveryNotificationEventSink(deliveryRepository, selectedNotifications.create)
      : undefined,
  );
  const selectedAuthenticator = authenticator ?? createAuthenticatorFromEnvironment();
  const selectedDispatch = dispatchDependencies ?? (pool ? (() => { const dispatchRepository = new PostgresDispatchJobRepository(pool); const providerRepository = new PostgresProviderRepository(pool); return { createDispatch: new CreateDispatchJob(deliveryRepository!, dispatchRepository), assignProvider: new AssignProvider(deliveryRepository!, dispatchRepository, providerRepository), actions: new DispatchActions(deliveryRepository!, dispatchRepository), createProvider: new CreateProvider(providerRepository) }; })() : undefined);
  const selectedPayments = paymentDependencies ?? (pool ? (() => { const paymentRepository = new PostgresPaymentRepository(pool); const gateway = new DeterministicPaymentGateway(); return { create: new CreatePayment(deliveryRepository!, paymentRepository), get: new GetPayment(deliveryRepository!, paymentRepository), initiate: new InitiatePayment(deliveryRepository!, paymentRepository, gateway), confirm: new ConfirmPayment(deliveryRepository!, paymentRepository), fail: new FailPayment(deliveryRepository!, paymentRepository), cancel: new CancelPayment(deliveryRepository!, paymentRepository) }; })() : undefined);
  return createServer((request, response) => { const requestId = requestIdFor(request); handle(request, response, selectedService, requestId, selectedAuthenticator, selectedDispatch, selectedPayments, selectedNotifications).catch((error: unknown) => { errorResponse(response, error, requestId); }); });
}

if (process.argv[1]?.endsWith('server.js')) {
  const server = createHttpServer();
  server.listen(PORT, () => { console.log(`Suftrip API listening on http://localhost:${PORT}`); });
}
