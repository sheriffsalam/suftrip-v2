# ADR-004: PostgreSQL Behind the Repository Port

## Status

Accepted for Phase 4.

## Decision

Use the lightweight `pg` driver in an infrastructure adapter implementing the existing `DeliveryJobRepository` port. Persist delivery jobs in explicit PostgreSQL columns and rehydrate through the domain aggregate.

## Rationale

PostgreSQL provides durable storage and database-enforced optimistic concurrency without leaking SQL or driver concerns into the domain and application layers. The existing in-memory adapter remains useful for unit and API tests.

Duplicate IDs are handled by the database primary key. Status updates use one `UPDATE ... WHERE id = ... AND version = ...` statement, so stale writes cannot overwrite newer state.

## Deferred

Domain events remain in-memory through `pullEvents()`. Kafka, queues, an outbox, and event-store persistence are deferred until a concrete asynchronous delivery requirement exists.
