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

Status transition rules and domain events remain in the domain. Domain-event persistence and external event transport are deferred.

## Database

PostgreSQL stores explicit delivery-job columns. The migration is `001-create-delivery-jobs.sql`, and `npm run db:migrate` applies it through the deterministic migration runner. The application requires `DATABASE_URL` when the production HTTP server is created.

## Authentication boundary

HTTP extracts a bearer credential and delegates validation to `AuthenticationPort`. The signed-token adapter uses HS256 and `AUTH_SECRET`, producing an `AuthenticatedPrincipal` with a user ID and `CUSTOMER` or `ADMIN` roles. Delivery application services enforce owner-or-admin access; the domain and repository do not perform authorization.

## Dispatch boundary

Dispatch is a separate bounded capability under the modular monolith. `DispatchJob` references `DeliveryJob` by ID and owns provider assignment state. Application use cases select eligible providers through ports. PostgreSQL assignment transactions conditionally change an available provider to `BUSY` and update the dispatch version together; failed claims roll back.

## Payments boundary

Payments is a separate bounded capability. `Payment` references `DeliveryJob` by ID and owns a financial obligation without changing delivery or dispatch aggregates. Amounts are positive safe integer minor units with an explicit three-letter currency. `PaymentRepository` performs atomic payment/attempt writes, version checks, and database-backed idempotency. The current gateway is an internal deterministic test adapter; no external financial transaction is represented.
