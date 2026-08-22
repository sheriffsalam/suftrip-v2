# Suftrip V2

Suftrip V2 is a logistics-first modular monolith built to demonstrate a production-oriented delivery platform without premature microservices or unnecessary infrastructure.

## What is implemented

- DeliveryJob lifecycle and optimistic concurrency
- PostgreSQL persistence and deterministic migrations
- Bearer authentication with customer/admin authorization
- Dispatch jobs and provider assignment
- Payment lifecycle with database-backed idempotency
- Notifications and delivery-status notification composition
- Transactional durable outbox with leased worker processing
- Durable notification delivery with PostgreSQL claiming, leases, retries, and at-least-once semantics
- Structured logging, health endpoint, security headers, and API rate limiting
- Unit, HTTP, and PostgreSQL integration test boundaries
- CI verification and Docker runtime packaging

## Architecture

Suftrip remains a **logistics-first modular monolith**. `DeliveryJob` is the reusable delivery aggregate. Dispatch, payments, and notifications are bounded capabilities inside the same deployable application boundary. Domain and application layers depend on ports; PostgreSQL and provider implementations remain infrastructure adapters.

The notification delivery worker uses PostgreSQL `FOR UPDATE SKIP LOCKED` and time-limited leases. No Kafka, RabbitMQ, Redis, or other broker is introduced.

See:

- `docs/ARCHITECTURE.md` — system boundaries and architectural rules
- `docs/DOMAIN-MODEL.md` — domain model
- `docs/API.md` — HTTP contract
- `docs/SECURITY.md` — authentication and authorization
- `docs/DEPLOYMENT.md` — local and production deployment
- `docs/TESTING.md` — verification strategy
- `docs/OBSERVABILITY.md` — logging and operational signals
- `docs/OUTBOX.md` — durable event delivery
- `docs/DECISIONS/` — architectural decisions

## Run locally

Requirements: Node.js 22+, Docker, and Docker Compose.

```text
docker compose up --build
```

The API is available on port `3000`. PostgreSQL remains internal to the Compose network except for the development port mapping. The Compose stack starts PostgreSQL, applies migrations before the API starts, and runs the outbox and notification delivery workers as separate runtime processes while keeping the same modular-monolith codebase and PostgreSQL persistence boundary.

For focused development without the full stack:

```text
docker compose up -d postgres
npm install
npm run db:migrate
npm test
npm run build
npm start
```

Integration tests run when `DATABASE_URL` is configured; otherwise they are intentionally skipped so unit/API verification remains portable.

## Verification gate

Before presenting a build:

```text
npm test
npm run build
npm audit --audit-level=high
git diff --check
docker build -t suftrip-v2 .
```

The project treats tests, strict TypeScript compilation, dependency audit, whitespace validation, and container build as separate verification signals.

## Product boundary

This repository is intentionally not a complete marketplace, routing engine, external payment processor, or identity-management system. Those capabilities remain outside the current bounded design unless explicitly added through an architectural decision. The goal is a usable and demonstrable logistics core with strong engineering and operational foundations.
