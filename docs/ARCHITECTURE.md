# Suftrip Architecture

Suftrip remains a logistics-first modular monolith. `DeliveryJob` is the reusable delivery aggregate.

## Core boundary

```text
HTTP/API -> Application -> Domain -> Ports
                                      ^
                                      |
                         Infrastructure adapters
                         (PostgreSQL / providers)
```

The domain and application layers contain no PostgreSQL, SQL, or driver imports. PostgreSQL adapters map database rows to domain snapshots and rehydrate aggregates through domain factories.

Status transition rules and domain events remain in the domain. Durable event transport is handled through the outbox boundary rather than coupling domain code to infrastructure.

## Database

PostgreSQL is the durable system of record. Explicit migrations are applied by the deterministic migration runner. The application does not silently mutate the schema during ordinary HTTP startup.

## Authentication boundary

HTTP extracts a bearer credential and delegates validation to `AuthenticationPort`. The signed-token adapter uses HS256 and `AUTH_SECRET`, producing an `AuthenticatedPrincipal` with a user ID and `CUSTOMER` or `ADMIN` roles. Application services enforce ownership and role authorization; the domain and repository do not perform authorization.

## Bounded capabilities

Dispatch, payments, and notifications are separate bounded capabilities inside the same modular-monolith codebase. They reference the reusable `DeliveryJob` by ID rather than embedding unrelated aggregate state.

Dispatch owns provider assignment state and PostgreSQL assignment transactions. Payments owns financial obligations, attempts, optimistic concurrency, and database-backed idempotency. Notifications owns notification lifecycle state and delivery attempts.

## Durable notification delivery

Notification delivery is durable and at-least-once. A PostgreSQL delivery queue claims `QUEUED` and retryable `FAILED` notifications with `FOR UPDATE SKIP LOCKED` and a time-limited worker lease. An expired lease is reclaimable by another worker. The application worker applies the domain `PROCESSING -> SENT` or `PROCESSING -> FAILED` transition and persists the attempt atomically with the aggregate update.

Worker ownership is checked at completion. A worker that loses its lease cannot overwrite the notification state. Provider delivery therefore remains an at-least-once boundary and concrete providers should use the stable attempt ID as an idempotency key where their APIs support it.

The current runnable notification worker is an infrastructure process using the application worker, PostgreSQL queue adapter, and deterministic sender. Running it as a separate process is an operational deployment choice, not a new service boundary. It does not introduce Kafka, RabbitMQ, Redis, or another broker.

## Runtime topology

The deployable demonstration can run four processes/containers against one PostgreSQL database:

```text
                 +----------------+
                 |   API process  |
                 +--------+-------+
                          |
                          v
                    +-----------+
                    | PostgreSQL|
                    +-----------+
                     ^         ^
                     |         |
             +-------+--+   +--+----------------+
             | Outbox   |   | Notification       |
             | Worker   |   | Delivery Worker    |
             +----------+   +--------------------+
```

These are deployment/runtime boundaries over the same modular monolith. They are not independent domain services. The database remains the shared persistence boundary defined by the original architecture.

## Zero-cost deployment constraint

The application must remain deployable without paid infrastructure for the portfolio demonstration. The application therefore keeps PostgreSQL as the only required stateful infrastructure and uses database-backed workers instead of introducing a managed broker. External provider integrations remain ports/adapters and can be added later without changing the domain model.
