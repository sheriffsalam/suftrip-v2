# Suftrip Testing

## Verification contract

The project uses a layered verification model:

1. Domain tests prove business invariants without infrastructure.
2. Application tests prove use cases through ports and in-memory adapters.
3. HTTP tests prove authentication, authorization, validation, response contracts, rate limiting, and end-to-end application composition.
4. PostgreSQL integration tests prove persistence, transactions, concurrency, leases, idempotency, and restart/durability behavior.
5. Container verification proves the deployable runtime can be built from the repository.

## Current coverage

Coverage includes DeliveryJob lifecycle and concurrency, dispatch lifecycle and concurrent provider assignment, payment lifecycle/idempotency/rollback, notification lifecycle/idempotency, durable outbox claiming and retries, notification delivery worker lifecycle, PostgreSQL notification leases and cross-worker claim behavior, authentication/authorization, HTTP validation, security headers, request IDs, and API rate limiting.

## PostgreSQL integration tests

Start PostgreSQL and apply migrations:

```text
docker compose up -d postgres
npm run db:migrate
```

Set `DATABASE_URL` from `.env.example`, then run:

```text
npm test
```

The integration suites are skipped when `DATABASE_URL` is absent. This keeps fast unit and HTTP verification independent from a developer database while still making the PostgreSQL boundary executable in CI or local verification.

## Notification delivery verification

`test/integration/postgres-notification-delivery-worker.test.ts` verifies:

- durable queue claiming;
- one-worker-only concurrent claiming;
- lease expiry and reclamation;
- previous-worker completion rejection after lease loss;
- application worker processing through the sender port.

## Product readiness gate

A Product Owner demonstration build must pass:

```text
npm test
npm run build
npm audit --audit-level=high
git diff --check
docker build -t suftrip-v2 .
```

When PostgreSQL is available, the complete integration suite must also run with `DATABASE_URL` configured and must not be represented as green when integration tests were skipped.

## Deliberately deferred coverage

Identity provisioning, real payment-provider contract tests, external notification provider contracts, webhooks, refunds, settlement, and fleet-wide shared rate limiting remain deferred capabilities. They should not be introduced merely to increase test count; each requires an explicit architectural/product decision.
