# Suftrip Deployment

## Local PostgreSQL

The canonical local stack is Docker Compose:

```text
docker compose up --build
```

It starts:

- `postgres` — PostgreSQL persistence
- `api` — canonical HTTP API
- `outbox-worker` — durable domain-event publication worker
- `notification-worker` — durable notification delivery worker

The API and both workers use the same PostgreSQL database. This is intentional: Suftrip remains a modular monolith with infrastructure processes separated operationally where useful, without turning domain capabilities into independent services or introducing a message broker.

Migrations are explicit and deterministic. The Compose API startup applies the checked-in migration set before starting the HTTP server. For focused local development, use `docker compose up -d postgres` followed by `npm run db:migrate`.

## Runtime configuration

Provide `DATABASE_URL` and `AUTH_SECRET` through the environment. `AUTH_SECRET` must be at least 32 characters. Notification worker settings are configurable through `NOTIFICATION_WORKER_*` environment variables; see `.env.example`.

The current notification sender is a deterministic internal adapter. It does not send real push, SMS, email, or other external messages. It exists to make the delivery pipeline durable, testable, and demonstrable without provider credentials or paid services.

## Container

The Dockerfile uses a Node 22 build stage and a production runtime stage. Production dependencies are installed explicitly in the runtime image, and the HTTP process runs as the non-root `node` user.

## Zero-cost deployment target

The deployment target is a free-tier environment consisting of one public API container, one worker runtime where required, and a free PostgreSQL service. The exact provider is intentionally kept out of application code. `DATABASE_URL`, `AUTH_SECRET`, `PORT`, and worker configuration are deployment inputs.

For a single-instance zero-cost demonstration, the API may be exposed publicly while PostgreSQL and workers remain private. If the hosting platform cannot run multiple long-lived processes, the API and workers can be evaluated separately using the same container image and command overrides; no new application architecture is required.

The API rate limiter is process-local. Do not treat it as a fleet-wide control when multiple API instances are introduced without an explicit shared-rate-limit adapter.

## Operational checks

At minimum verify:

```text
GET /health
npm test
npm run build
npm audit --audit-level=high
git diff --check
docker build -t suftrip-v2 .
```

A deployment is not considered ready for Product Owner demonstration until the live API responds, the database migrations are applied, the core delivery flow is executable, and the worker processes can be started and stopped cleanly.
