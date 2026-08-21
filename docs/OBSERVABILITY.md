# Suftrip Observability

## Implemented

The HTTP boundary accepts or generates an `x-request-id` and returns it in every response. Error responses include the same request ID.

PostgreSQL failures are translated at the repository boundary and retain the request ID when they cross the HTTP boundary.

Authentication and authorization failures also retain the request ID in their response contract. Tokens and authorization headers are not logged.

Dispatch assignment failures are returned as typed conflicts and retain the request ID. Provider assignment metrics are deferred with the broader metrics platform.

## Proposed

Structured logging, database/request latency metrics, delivery creation and transition counters, transition-failure metrics, and tracing are not implemented yet. The request ID is the current application boundary reserved for future logging and tracing adapters.
