import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { DeliveryService } from '../../src/application/delivery/delivery-service.js';
import { InMemoryDeliveryJobRepository } from '../../src/application/delivery/in-memory-delivery-job-repository.js';
import { CreateDispatchJob } from '../../src/application/dispatch/create-dispatch-job.js';
import { AssignProvider } from '../../src/application/dispatch/assign-provider.js';
import { DispatchActions } from '../../src/application/dispatch/dispatch-actions.js';
import { CreateProvider } from '../../src/application/dispatch/create-provider.js';
import { InMemoryDispatchJobRepository, InMemoryProviderRepository } from '../../src/application/dispatch/in-memory-dispatch-repository.js';
import { SignedBearerTokenAuthenticator } from '../../src/infrastructure/auth/signed-bearer-token-authenticator.js';
import { createHttpServer } from '../../src/http/server.js';

const secret = 'phase-six-http-secret-that-is-at-least-32-characters';
const authenticator = new SignedBearerTokenAuthenticator(secret);
const customer = { userId: 'http-customer', roles: ['CUSTOMER'] as const };
const admin = { userId: 'http-admin', roles: ['ADMIN'] as const };
const provider = { userId: 'http-provider', roles: ['PROVIDER'] as const };

function requestJson(port: number, method: string, path: string, token: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = httpRequest({
      port,
      method,
      path,
      headers: {
        authorization: `Bearer ${token}`,
        ...(payload ? { 'content-type': 'application/json' } : {}),
      },
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

describe('Dispatch HTTP API', () => {
  let server: ReturnType<typeof createHttpServer>;
  let port: number;

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it('runs the authenticated delivery-to-dispatch-to-provider flow', async () => {
    const deliveries = new InMemoryDeliveryJobRepository();
    const deliveryService = new DeliveryService(deliveries);
    const providers = new InMemoryProviderRepository();
    const dispatches = new InMemoryDispatchJobRepository(providers.values());
    const dependencies = {
      createDispatch: new CreateDispatchJob(deliveries, dispatches),
      assignProvider: new AssignProvider(deliveries, dispatches, providers),
      actions: new DispatchActions(deliveries, dispatches),
      createProvider: new CreateProvider(providers),
    };
    server = createHttpServer(deliveryService, authenticator, dependencies);
    await new Promise<void>((resolve, reject) => {
      server.listen(0, () => resolve());
      server.once('error', reject);
    });
    port = (server.address() as AddressInfo).port;

    const customerToken = authenticator.issue(customer);
    const adminToken = authenticator.issue(admin);
    const providerToken = authenticator.issue(provider);

    expect((await requestJson(port, 'POST', '/api/v1/providers', adminToken, {
      id: provider.userId,
      availability: 'AVAILABLE',
      location: { latitude: 6.6, longitude: 3.35 },
    })).status).toBe(201);

    expect((await requestJson(port, 'POST', '/api/v1/delivery-jobs', customerToken, {
      id: 'http-dispatch-delivery',
      requesterId: 'spoofed-user',
      pickup: { address: 'Pickup', latitude: 6.6, longitude: 3.35 },
      dropoff: { address: 'Dropoff', latitude: 6.4, longitude: 3.42 },
      deliveryType: 'PARCEL',
    })).body).toMatchObject({ requesterId: customer.userId });

    const created = await requestJson(port, 'POST', '/api/v1/delivery-jobs/http-dispatch-delivery/dispatch', customerToken, { id: 'http-dispatch-job' });
    expect(created.body).toMatchObject({ status: 'SEARCHING', deliveryJobId: 'http-dispatch-delivery' });

    const assigned = await requestJson(port, 'POST', '/api/v1/dispatch-jobs/http-dispatch-job/assign', customerToken, {});
    expect(assigned.body).toMatchObject({ status: 'PROVIDER_ASSIGNED', assignedProviderId: provider.userId });

    const accepted = await requestJson(port, 'POST', '/api/v1/dispatch-jobs/http-dispatch-job/accept', providerToken, {});
    expect(accepted.body).toMatchObject({ status: 'PROVIDER_ACCEPTED' });

    const retrieved = await requestJson(port, 'GET', '/api/v1/dispatch-jobs/http-dispatch-job', customerToken);
    expect(retrieved.body).toMatchObject({ status: 'PROVIDER_ACCEPTED', version: 3 });
  });
});