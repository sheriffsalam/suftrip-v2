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
- Responsive customer browser application in `web/`
- One-service public launcher that serves the frontend and API together
- Render Blueprint for a zero-cost prototype deployment
- CI verification covering build, PostgreSQL integration tests, audit, and whitespace checks

## Architecture

Suftrip remains a **logistics-first modular monolith**. `DeliveryJob` is the reusable delivery aggregate. Dispatch, payments, and notifications are bounded capabilities inside the same deployable application boundary. Domain and application layers depend on ports; PostgreSQL and provider implementations remain infrastructure adapters.

The notification delivery worker uses PostgreSQL `FOR UPDATE SKIP LOCKED` and time-limited leases. No Kafka, RabbitMQ, Redis, or other broker is introduced.

See:

- `docs/ARCHITECTURE.md` — system boundaries and architectural rules
- `docs/DOMAIN-MODEL.md` — domain model
- `docs/API.md` — HTTP contract
- `docs/SECURITY.md` — authentication and authorization
- `docs/DEPLOYMENT.md` — local and public prototype deployment
- `docs/TESTING.md` — verification strategy
- `docs/OBSERVABILITY.md` — logging and operational signals
- `docs/OUTBOX.md` — durable event delivery
- `docs/DECISIONS/` — architectural decisions

## Free public prototype

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/sheriffsalam/suftrip-v2)

The repository contains `render.yaml`. The free Render deployment provisions the Node API/frontend service and a free PostgreSQL database. The browser app is served from the same HTTPS origin, so there is no browser CORS or frontend secret configuration.

The prototype enables `DEMO_AUTH=true` and accepts the browser-only demo credential `demo:customer`. This is intentionally gated on the server and is **not a production authentication mechanism**.

The free Render Postgres tier is 1 GB and currently expires after 30 days, so this deployment is for testing, demonstrations, and early validation rather than permanent production storage.

## Run locally

Requirements: Node.js 22+, Docker, and Docker Compose.

```text
docker compose up --build
```

The API is available on port `3000`. PostgreSQL remains internal to the Compose network except for the development port mapping.

For focused development without the full stack:

```text
docker compose up -d postgres
npm install
npm run db:migrate
npm test
npm run build
npm start
```

To run the complete browser experience locally after the database is available:

```text
$env:DATABASE_URL="postgres://suftrip:development-only@localhost:5432/suftrip"
$env:AUTH_SECRET="local-development-secret-that-is-long-enough"
$env:DEMO_AUTH="true"
npm run build
npm run db:migrate:runtime
npm run start:public
```

Then open `http://localhost:3000` and choose **Enter customer demo**.

## Verification gate

Before presenting a build:

```text
npm test
npm run build
npm audit --audit-level=high
git diff --check
docker build -t suftrip-v2 .
```

CI repeats the build, PostgreSQL-backed integration tests, dependency audit, and whitespace validation on GitHub Actions.

## Product boundary

This repository is intentionally not a complete marketplace, routing engine, external payment processor, or identity-management system. Those capabilities remain outside the current bounded design unless explicitly added through an architectural decision. The current browser experience is a usable delivery prototype backed by the logistics core.
