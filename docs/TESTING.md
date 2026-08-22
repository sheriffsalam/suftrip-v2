# Suftrip Testing

## Implemented

The project runs TypeScript compilation with `npm run build` and tests with `npm test`.

Current coverage includes:

- DeliveryJob creation and validation.
- Lifecycle transitions, cancellation, terminal states, versions, and domain events.
- Application creation, retrieval, duplicate creation, status changes, not-found behavior, and stale versions.
- HTTP creation, retrieval, malformed JSON, validation errors, request IDs, not-found responses, invalid transitions, conflicts, duplicate creates, and rate limiting.
- PostgreSQL persistence, restart durability, timestamp preservation, duplicate IDs, and database-enforced stale-write conflicts when `DATABASE_URL` is configured.
- Authentication failures, token expiry, role authorization, ownership authorization, admin access, security headers, and requester identity spoofing.
- Dispatch lifecycle, deterministic provider selection, provider release/redispatch, authenticated HTTP dispatch flow, PostgreSQL dispatch persistence, and concurrent provider assignment.
- Payment money/lifecycle validation, ownership, attempts, idempotency, authenticated API flow, PostgreSQL persistence, rollback, and concurrent terminal transitions.

## Test boundaries

Domain tests are isolated from HTTP. Application tests use the in-memory repository. HTTP tests use an ephemeral Node HTTP server and the application ports. Rate-limit tests inject the rate-limiter port so enforcement is deterministic and independent of wall-clock timing.

## PostgreSQL integration tests

Start PostgreSQL and apply migrations with `docker compose up -d postgres` followed by `npm run db:migrate`. Set `DATABASE_URL` from `.env.example`, then run `npx vitest run test/integration/postgres-delivery-job-repository.test.ts`.

Payment integration coverage is in `test/integration/postgres-payment.test.ts` and `test/integration/postgres-payment-http.test.ts`; run either explicitly or use `npm test` with `DATABASE_URL` configured.

The integration suite is skipped when `DATABASE_URL` is absent so unit and API tests do not depend on a developer's database.

## Future coverage

Identity provisioning, real gateway contract tests, webhooks, refunds, settlement tests, and distributed/shared rate limiting are not implemented until later phases.
