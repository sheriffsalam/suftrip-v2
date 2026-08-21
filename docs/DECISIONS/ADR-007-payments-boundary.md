# ADR-007: Payments as a Bounded Capability

## Status

Accepted for Phase 7.

## Decision

Implement Payments as a separate bounded capability in the modular monolith. `Payment` references `DeliveryJob` by ID and owns payment state; `DeliveryJob` and Dispatch remain independent. Payment attempts are separate records so retries and operation-specific idempotency can be represented without duplicating the obligation.

Represent money as positive integer minor units with an explicit three-letter currency. Persist payment creation keys and operation keys in PostgreSQL. Payment state changes and attempt records are committed in one transaction with an optimistic version condition, so concurrent confirmations cannot corrupt the payment.

Use an internal deterministic gateway adapter for Phase 7 initialization only. It produces a test reference and does not claim that an external financial transaction occurred.

## Rationale

The boundary preserves the existing modular monolith and repository-port architecture while making payment state durable and retry-safe. Database-backed idempotency is authoritative across process restarts and does not require Redis.

## Deferred

External gateways, webhooks, wallets, refunds, payouts, settlements, accounting, invoices, tax, PCI infrastructure, Kafka, Redis, and payment event streaming are deferred.