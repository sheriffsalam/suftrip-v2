# ADR-006: Dispatch as a Bounded Logistics Capability

## Status

Accepted for Phase 6.

## Decision

Implement Dispatch as a separate bounded capability in the modular monolith. `DispatchJob` references `DeliveryJob` by ID and owns provider assignment state; `DeliveryJob` remains responsible only for delivery lifecycle and logistics request data.

Provider selection is deterministic: filter `AVAILABLE` providers, calculate straight-line geodesic distance from pickup, and break ties by provider ID. Assignment uses a PostgreSQL transaction that conditionally claims provider availability and advances the dispatch version, preventing two active dispatches from claiming the same provider.

## Rationale

The boundary keeps provider matching out of the core delivery aggregate and supports parcel, food, document, and other delivery types without vertical-specific rules. The modular monolith and existing repository ports avoid premature service, broker, or locking infrastructure.

## Deferred

Routing APIs, ETA, GPS tracking, sophisticated optimization, provider profiles, external provider APIs, Redis, Kafka, durable event publication, and financial or notification workflows are deferred.