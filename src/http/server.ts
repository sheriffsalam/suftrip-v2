import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { DeliveryService } from '../application/delivery/delivery-service.js';
import { InMemoryDeliveryJobRepository } from '../application/delivery/in-memory-delivery-job-repository.js';
import type { DeliveryStatus } from '../domain/delivery/delivery-job.js';

const repository = new InMemoryDeliveryJobRepository();
const deliveryService = new DeliveryService(repository);

const PORT = Number(process.env.PORT ?? 3000);

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};

  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return typeof value === 'string' && [
    'DRAFT', 'REQUESTED', 'QUOTING', 'BOOKED', 'SEARCHING_FOR_PROVIDER',
    'PROVIDER_ASSIGNED', 'PROVIDER_ACCEPTED', 'ARRIVING_FOR_PICKUP',
    'PICKED_UP', 'IN_TRANSIT', 'ARRIVING', 'DELIVERED', 'CANCELLED',
  ].includes(value);
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { status: 'ok', service: 'suftrip-v2' });
    return;
  }

  if (method === 'POST' && parts.length === 1 && parts[0] === 'delivery-jobs') {
    const body = await readJson(request);
    const id = typeof body.id === 'string' && body.id.trim() ? body.id : randomUUID();
    sendJson(response, 201, await deliveryService.create({ id }));
    return;
  }

  if (parts.length === 2 && parts[0] === 'delivery-jobs') {
    const id = decodeURIComponent(parts[1] ?? '');

    if (method === 'GET') {
      const job = await deliveryService.get(id);
      if (!job) {
        sendJson(response, 404, { error: `DeliveryJob not found: ${id}` });
        return;
      }
      sendJson(response, 200, job);
      return;
    }

    if (method === 'PATCH' && parts[1]) {
      const body = await readJson(request);
      const expectedVersion = body.expectedVersion;
      const nextStatus = body.nextStatus;

      if (!Number.isInteger(expectedVersion) || expectedVersion < 0 || !isDeliveryStatus(nextStatus)) {
        sendJson(response, 400, { error: 'expectedVersion must be a non-negative integer and nextStatus must be a valid DeliveryStatus' });
        return;
      }

      sendJson(response, 200, await deliveryService.changeStatus(id, expectedVersion, nextStatus));
      return;
    }
  }

  sendJson(response, 404, { error: 'Route not found' });
}

const server = createServer((request, response) => {
  handle(request, response).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const statusCode = message.includes('not found') ? 404 : message.includes('conflict') ? 409 : 400;
    sendJson(response, statusCode, { error: message });
  });
});

server.listen(PORT, () => {
  console.log(`Suftrip API listening on http://localhost:${PORT}`);
});
