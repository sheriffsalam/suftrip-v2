# Suftrip Observability

## Implemented

The HTTP boundary accepts or generates an `x-request-id` and returns it in every response. Error responses include the same request ID.

PostgreSQL failures are translated at the repository boundary and retain the request ID when they cross the HTTP boundary.

Authentication and authorization failures also retain the request ID in their response contract. Tokens and authorization headers are not logged.

Dispatch assignment failures are returned as typed conflicts and retain the request ID. Provider assignment metrics are deferred with the broader metrics platform.

Payment operation failures retain request IDs. Payment amounts, idempotency keys, authorization headers, and any future provider credentials must not be logged.

The application now exposes a `Logger` port. The HTTP boundary emits structured `http.request.completed` records containing request ID, method, path, status code, and duration. Unexpected request failures emit `http.request.failed` without credentials or request bodies. The default infrastructure adapter is `JsonLogger`, which writes one JSON record per line.

Logging is injected into `createHttpServer`, so tests and future production sinks can replace the default logger without changing application code.

## Rate limiting

The versioned API (`/api/v1/*`) is protected by a fixed-window rate limiter at the HTTP boundary. The public `/health` endpoint is intentionally excluded.

The default limit is 120 requests per 60 seconds per client socket address. Deployments can override the defaults with `RATE_LIMIT_REQUESTS` and `RATE_LIMIT_WINDOW_MS`. A production deployment behind a trusted reverse proxy should ensure the application receives the appropriate client connection identity; the current implementation deliberately does not trust arbitrary forwarding headers.

Rate-limited responses return HTTP `429` with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers and the standard request-ID error envelope. The current adapter is process-local and therefore intended as a bounded single-instance protection layer; distributed rate limiting is deferred until a shared infrastructure adapter is introduced.

## Proposed

Structured database/request latency metrics, delivery creation and transition counters, transition-failure metrics, distributed tracing, log correlation across asynchronous work, centralized log shipping, and a shared distributed rate-limit adapter are not implemented yet. The request ID, logger port, and rate-limiter port are the application boundaries reserved for those future adapters.
