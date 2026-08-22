# Suftrip Observability

## Implemented

The HTTP boundary accepts or generates an `x-request-id` and returns it in every response. Error responses include the same request ID.

PostgreSQL failures are translated at the repository boundary and retain the request ID when they cross the HTTP boundary.

Authentication and authorization failures also retain the request ID in their response contract. Tokens and authorization headers are not logged.

Dispatch assignment failures are returned as typed conflicts and retain the request ID. Provider assignment metrics are deferred with the broader metrics platform.

Payment operation failures retain request IDs. Payment amounts, idempotency keys, authorization headers, and any future provider credentials must not be logged.

The application now exposes a `Logger` port. The HTTP boundary emits structured `http.request.completed` records containing request ID, method, path, status code, and duration. Unexpected request failures emit `http.request.failed` without credentials or request bodies. The default infrastructure adapter is `JsonLogger`, which writes one JSON record per line.

Logging is injected into `createHttpServer`, so tests and future production sinks can replace the default logger without changing application code.

## Proposed

Structured database/request latency metrics, delivery creation and transition counters, transition-failure metrics, distributed tracing, log correlation across asynchronous work, and centralized log shipping are not implemented yet. The request ID and logger port are the application boundaries reserved for those future adapters.
