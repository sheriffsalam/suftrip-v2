# Suftrip Testing

## Implemented

The project runs TypeScript compilation with `npm run build` and tests with `npm test`.

Current coverage includes:

- DeliveryJob creation and validation.
- Lifecycle transitions, cancellation, terminal states, versions, and domain events.
- Application creation, retrieval, duplicate creation, status changes, not-found behavior, and stale versions.
- HTTP creation, retrieval, malformed JSON, validation errors, request IDs, not-found responses, invalid transitions, conflicts, and duplicate creates.
- PostgreSQL persistence, restart durability, timestamp preservation, duplicate IDs, and database-enforced stale-write conflicts when `DATABASE_URL` is configured.
- Authentication failures, token expiry, role authorization, ownership authorization, admin access, security headers, and requester identity spoofing.
- Dispatch lifecycle, deterministic provider selection, provider release/redispatch, authenticated HTTP dispatch flow, PostgreSQL dispatch persistence, and concurrent provider assignment.

## Test boundaries

Domain tests are isolated from HTTP. Application tests use the in-memory repository. HTTP tests use an ephemeral Node HTTP server and the application ports.

## PostgreSQL integration tests

Start PostgreSQL and apply migrations with `docker compose up -d postgres` followed by `npm run db:migrate`. Set `DATABASE_URL` from `.env.example`, then run `npx vitest run test/integration/postgres-delivery-job-repository.test.ts`.

The integration suite is skipped when `DATABASE_URL` is absent so unit and API tests do not depend on a developer's database.

## Future coverage

Rate limiting, identity provisioning, and external adapter contract tests are not implemented until their phases begin.
