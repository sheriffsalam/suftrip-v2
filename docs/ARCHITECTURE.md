# Suftrip Architecture

Suftrip remains a logistics-first modular monolith. `DeliveryJob` is the reusable delivery aggregate.

## Implemented Phase 4 boundary

```text
HTTP/API -> Application -> Domain -> DeliveryJobRepository
                                      ^
                                      |
                         PostgreSQL infrastructure adapter
```

The domain and application layers contain no PostgreSQL, SQL, or driver imports. `PostgresDeliveryJobRepository` maps database rows to `DeliveryJobSnapshot` values and rehydrates through `DeliveryJob.rehydrate()`.

Status transition rules and domain events remain in the domain. Durable event transport is handled through the outbox boundary rather than coupling domain code to infrastructure.

## Database

PostgreSQL stores explicit delivery-job columns. The migration is `001-create-delivery-jobs.sql`, and `npm run db:migrate` applies it through the deterministic migration runner. The application requires `DATABASE_URL` when the production HTTP server is created.

## Authentication boundary

HTTP extracts a bearer credential and delegates validation to `AuthenticationPort`. The signed-token adapter uses HS256 and `AUTH_SECRET`, producing an `AuthenticatedPrincipal` with a user ID and `CUSTOMER` or `ADMIN` roles. Delivery application services enforce owner-or-admin access; the domain and repository do not perform authorization.

## Dispatch boundary

Dispatch is a separate bounded capability under the modular monolith. `DispatchJob` references `DeliveryJob` by ID and owns provider assignment state. Application use cases select eligible providers through ports. PostgreSQL assignment transactions conditionally change an available provider to `BUSY` and update the dispatch version together; failed claims roll back.

## Payments boundary

Payments is a separate bounded capability. `Payment` references `DeliveryJob` by ID and owns a financial obligation without changing delivery or dispatch aggregates. Amounts are positive safe integer minor units with an explicit three-letter currency. `PaymentRepository` performs atomic payment/attempt writes, version checks, and database-backed idempotency. The current gateway is an internal deterministic test adapter; no external financial transaction is represented.

## Notifications boundary

Notifications is a separate bounded capability under the same modular monolith. `Notification` owns notification lifecycle state and `NotificationAttempt` records delivery attempts. Application code depends on `NotificationRepository`, `NotificationSender`, and `NotificationDeliveryQueue` ports; PostgreSQL and provider adapters remain in infrastructure.

Notification delivery is durable and at-least-once. A PostgreSQL delivery queue claims `QUEUED` and retryable `FAILED` notifications with `FOR UPDATE SKIP LOCKED` and a time-limited worker lease. An expired lease is reclaimable by another worker. The application worker then applies the domain `PROCESSING -> SENT` or `PROCESSING -> FAILED` transition and persists the attempt atomically with the aggregate update. The worker never introduces Kafka, RabbitMQ, Redis, or another broker.

Worker ownership is checked at completion. A worker that loses its lease to another worker cannot overwrite the notification state. Provider delivery therefore remains an at-least-once boundary and concrete providers must use the stable attempt ID as their idempotency key where their APIs support it.
