# Suftrip V2

**Logistics-first delivery platform | Production-oriented prototype | Low-cost by design**

Suftrip V2 is a delivery and logistics platform designed around one reusable business primitive: the **DeliveryJob**. The current release is a usable browser application backed by PostgreSQL and a modular monolith. It is intentionally simple to operate today while preserving clear domain boundaries for future scale.

**Live prototype:** https://suftrip.onrender.com  
**Health:** https://suftrip.onrender.com/health  
**Repository:** https://github.com/sheriffsalam/suftrip-v2

---

## 1. Management summary

Suftrip V2 demonstrates that the core logistics platform can be delivered without starting with expensive microservices or managed infrastructure.

Today, the system provides:

- Customer-facing browser experience
- Delivery-job lifecycle management
- PostgreSQL persistence
- Authentication and customer/admin authorization
- Dispatch and provider assignment
- Payment lifecycle and idempotency controls
- Notification composition and durable delivery processing
- Health checks, structured logging, security headers and rate limiting
- Automated tests and CI verification
- Public HTTPS deployment on Render

### Business value

The architecture keeps the cost and operational burden low while protecting the most important future investment: **clean business boundaries**. Dispatch, payments, notifications and delivery are already separated logically, so they can later become independent services without rewriting the business model from scratch.

### Current operating model

```text
Customer
   |
 HTTPS
   v
Suftrip Public App
   |
   +--> Browser UI
   |
   +--> HTTP/API
          |
          v
   Modular Monolith
   |       |       |
Delivery Dispatch Payments Notifications
   |       |       |       |
   +-------+-------+-------+
                   |
                   v
               PostgreSQL
```

The current deployment intentionally avoids Kafka, RabbitMQ, Redis, Kubernetes and multiple application servers. PostgreSQL provides the durable state and queue/lease primitives required by the current workload.

---

## 2. Current production/prototype status

| Area | Status |
|---|---|
| Public HTTPS application | **LIVE** |
| Health endpoint | **PASS** |
| TypeScript build | **PASS** |
| PostgreSQL migration at startup | **PASS** |
| PostgreSQL persistence | **IMPLEMENTED** |
| Delivery lifecycle | **IMPLEMENTED** |
| Dispatch/provider assignment | **IMPLEMENTED** |
| Payment lifecycle | **IMPLEMENTED** |
| Notifications/outbox | **IMPLEMENTED** |
| Automated verification | **IMPLEMENTED** |
| External payment processor | **NOT YET CONNECTED** |
| External notification provider | **NOT YET CONNECTED** |
| Enterprise identity provider | **NOT YET CONNECTED** |
| Full marketplace/routing engine | **NOT YET IMPLEMENTED** |

The public release is therefore a **usable delivery prototype**, not a claim that every enterprise logistics capability is already production-complete.

---

## 3. Product boundary

Suftrip is **logistics-first**. Food delivery, courier delivery, business deliveries and other verticals can reuse the same DeliveryJob abstraction rather than creating separate logistics systems.

The core model is:

```text
DeliveryJob
  ├── pickup
  ├── dropoff
  ├── customer
  ├── delivery type
  ├── lifecycle status
  └── version

Capabilities around it:
  ├── Dispatch
  ├── Payments
  └── Notifications
```

This separation prevents a future product vertical from contaminating the core logistics domain.

---

## 4. Current low-cost architecture

### Recommended architecture for the current user-facing release

```text
                         Internet
                            |
                         HTTPS
                            |
                            v
                  +--------------------+
                  | Render Web Service |
                  |                    |
                  |  Web UI            |
                  |  HTTP API          |
                  |  Application       |
                  |  Domain            |
                  |  Infrastructure    |
                  +---------+----------+
                            |
                            | SQL
                            v
                  +--------------------+
                  | PostgreSQL         |
                  |                    |
                  | business state     |
                  | idempotency        |
                  | outbox             |
                  | notification queue |
                  +--------------------+
```

### Why this is the preferred starting point

1. One deployable application is cheap and easy to operate.
2. One PostgreSQL database removes distributed-system complexity.
3. Same-origin frontend/API removes unnecessary CORS and frontend secret management.
4. PostgreSQL transactions provide strong consistency for core workflows.
5. Database-backed idempotency protects retry-sensitive operations.
6. PostgreSQL row locking and leases avoid introducing a message broker prematurely.
7. Clear module boundaries preserve the option to extract services later.

### Cost principle

**Do not buy infrastructure for hypothetical scale.** Introduce Redis, Kafka, Kubernetes, service meshes or separate databases only when measured workload, availability requirements or team boundaries justify them.

---

## 5. Mature target architecture

The target architecture is a **domain-aligned service platform**, not microservices for their own sake.

```text
                              Internet
                                  |
                              CDN/WAF
                                  |
                         API Gateway / BFF
                                  |
              +-------------------+-------------------+
              |                   |                   |
        Delivery Service    Dispatch Service    Identity/Auth
              |                   |                   |
              +-------------------+-------------------+
                                  |
                         Event / Messaging Layer
                         (introduced when needed)
                                  |
          +---------------+------+-------+---------------+
          |               |              |               |
     Payment Service  Notification   Tracking       Future Vertical
                         Service       Service       Services
          |               |              |               |
       DB-PAY          DB-NOTIFY      DB-TRACK       DB-VERTICAL
```

### Target principles

- Each service owns a business capability.
- Each service owns its data.
- No service reads another service's database directly.
- Synchronous APIs are used for immediate decisions.
- Events are used for asynchronous side effects.
- Every externally retried command is idempotent.
- Authentication is centralized; authorization remains capability-aware.
- Observability is standardized across services.
- Deployment is independently versioned only when independence provides value.

---

## 6. Step-by-step path from today's monolith to microservices

**Do not split the application in one migration.** Use a strangler approach and extract one bounded capability at a time.

### Stage 0 — Current baseline

Keep the modular monolith.

Required controls:

- Automated tests
- PostgreSQL migrations
- Structured logs
- Health/readiness checks
- Idempotency
- Rate limiting
- Security headers
- Architecture decision records
- CI build and audit gates

**Exit criterion:** stable production workload and measurable bottlenecks.

### Stage 1 — Harden module boundaries

Before extracting anything:

1. Remove cross-module database access.
2. Expose module interfaces through application ports.
3. Keep domain models private to their bounded capability.
4. Add contract tests around module interfaces.
5. Document commands, queries and events.
6. Measure latency, error rate, database load and queue depth.

**Exit criterion:** modules can be replaced without changing unrelated domain code.

### Stage 2 — Introduce an event contract

Add a versioned internal event model while keeping PostgreSQL as the durable source of truth.

Example:

```text
DeliveryCreated.v1
DeliveryAssigned.v1
DeliveryPickedUp.v1
DeliveryCompleted.v1
PaymentAuthorized.v1
```

Continue using the transactional outbox. Do not introduce Kafka merely because events exist.

**Exit criterion:** asynchronous side effects can consume stable event contracts.

### Stage 3 — Extract Notifications

Notifications are the safest first extraction because they are mostly side effects.

```text
Delivery Service
      |
      | DeliveryCompleted event
      v
Notification Service
      |
      +--> Email
      +--> SMS
      +--> Push
```

Steps:

1. Define notification event contracts.
2. Move notification persistence behind a service API.
3. Keep an outbox in the delivery system.
4. Add a reliable event publisher.
5. Deploy notification service alongside the monolith.
6. Shadow/dual-process safely where required.
7. Compare results.
8. Switch traffic to the service.
9. Remove the old notification module.

### Stage 4 — Extract Dispatch

Dispatch is a stronger candidate for independent scaling because assignment and provider availability can become high-frequency workloads.

Steps:

1. Define Provider and Dispatch contracts.
2. Move dispatch state ownership into Dispatch Service.
3. Create a Dispatch database.
4. Introduce `DeliveryAssigned` and provider-status events.
5. Route new dispatch commands to the service.
6. Keep Delivery Service as the owner of delivery lifecycle.
7. Remove direct dispatch persistence from the monolith.

### Stage 5 — Extract Payments

Payments should be isolated for security, compliance and operational control.

Steps:

1. Define Payment API and event contracts.
2. Introduce an external payment gateway adapter.
3. Create a dedicated payment database.
4. Enforce idempotency keys at the payment boundary.
5. Implement webhook verification.
6. Add reconciliation jobs.
7. Introduce audit trails.
8. Route payment operations to Payment Service.
9. Remove payment persistence from the monolith.

### Stage 6 — Extract Delivery Core

Only after the surrounding capabilities are independent should the Delivery Core become its own service.

```text
                 API/BFF
                    |
          +---------+---------+
          |                   |
   Delivery Service      Dispatch Service
          |                   |
          +-------- Events ---+
                    |
          +---------+---------+
          |         |         |
      Payment  Notification Tracking
```

At this point the original monolith has effectively been decomposed without a risky big-bang rewrite.

### Stage 7 — Platform scaling

Only when justified by measured traffic:

- Managed database scaling/read replicas
- Redis for hot/cache data
- Message broker for high-volume event streams
- CDN/WAF
- Object storage
- Container orchestration
- Autoscaling
- Multi-region strategy

Kubernetes should be introduced only when the number of services, deployment frequency or availability requirements justify its operational cost.

---

## 7. Recommended scaling triggers

Technology should follow evidence.

| Trigger | First response |
|---|---|
| Slow database queries | Index/query optimization |
| High repeated reads | Cache selectively |
| Background queue growth | Increase workers / tune leases |
| API CPU saturation | Scale web instances |
| Dispatch workload spikes | Extract/scale Dispatch |
| Notification workload spikes | Extract Notification |
| Payment compliance needs | Isolate Payment Service |
| Event throughput becomes large | Introduce managed broker |
| Many independently deployed services | Consider orchestration |
| Multi-region requirement | Design regional architecture |

The objective is **maximum business throughput per unit of infrastructure**, not maximum infrastructure complexity.

---

## 8. Developer implementation rules

Any developer extending Suftrip should follow these rules.

### Domain

- Business invariants belong in domain objects.
- Domain code must not import PostgreSQL, HTTP or infrastructure drivers.
- Do not put SQL in domain/application services.

### Application

- Use cases orchestrate business operations.
- Depend on ports/interfaces rather than concrete infrastructure.
- Enforce authorization at the application boundary.

### Infrastructure

- PostgreSQL repositories implement application ports.
- External providers are adapters.
- Database transactions must be explicit around consistency boundaries.

### API

- Validate input at the boundary.
- Return stable error shapes.
- Never expose secrets.
- Make retry-sensitive commands idempotent.

### Database

- Every schema change is a deterministic migration.
- Never manually modify production schema.
- Avoid cross-module tables without an explicit architectural decision.

### Reliability

- Background work must be retryable.
- Use leases for worker ownership.
- Assume delivery is at-least-once unless a stronger guarantee is explicitly designed.
- Never assume a network request happens exactly once.

### Observability

Every production capability should expose:

- structured logs;
- request/operation identifiers;
- latency;
- error rate;
- success rate;
- queue depth where applicable;
- database health;
- dependency health.

---

## 9. Security baseline

The application currently includes bearer authentication, role-aware authorization, security headers and rate limiting. Production deployments must use a strong secret supplied by the platform rather than committed configuration.

Before handling real money or sensitive customer data, add:

- managed identity/authentication provider;
- verified payment webhooks;
- secrets management;
- audit logging;
- encryption/key management requirements;
- fraud controls;
- data retention policy;
- backup and disaster recovery;
- formal access review.

---

## 10. Deployment

The current public prototype uses Render with a single Node service and PostgreSQL. The application and API share one HTTPS origin.

Build:

```bash
npm ci --include=dev
npm run build
```

Runtime:

```bash
npm run db:migrate:runtime && npm run start:public
```

Local development:

```bash
docker compose up -d postgres
npm install
npm run db:migrate
npm test
npm run build
```

The free Render PostgreSQL configuration is intended for prototype/testing use, not permanent production storage. Production should use a managed PostgreSQL plan with backups, monitoring and an appropriate retention policy.

---

## 11. Verification gate

Before merging or deploying:

```bash
npm test
npm run build
npm audit --audit-level=high
git diff --check
docker build -t suftrip-v2 .
```

CI should remain a mandatory quality gate.

---

## 12. Documentation map

| Document | Purpose |
|---|---|
| `docs/ARCHITECTURE.md` | Current architecture and boundaries |
| `docs/DOMAIN-MODEL.md` | Domain model |
| `docs/API.md` | HTTP API contract |
| `docs/SECURITY.md` | Security model |
| `docs/DEPLOYMENT.md` | Deployment and operations |
| `docs/TESTING.md` | Test strategy |
| `docs/OBSERVABILITY.md` | Operational signals |
| `docs/OUTBOX.md` | Durable asynchronous processing |
| `docs/DECISIONS/` | Architecture decisions |

---

## 13. Executive conclusion

**Suftrip V2 is deliberately built in two layers of thinking:**

1. **Operate cheaply today:** one public service, one PostgreSQL database, minimal infrastructure and a usable customer experience.
2. **Scale intelligently tomorrow:** bounded modules, explicit interfaces, durable events and data ownership that allow individual capabilities to become services when real demand requires it.

This avoids the two common failures of early-stage platforms: building a fragile monolith with no boundaries, or building an expensive microservice estate before the business needs it.

Suftrip's architecture therefore follows a simple rule:

> **Start simple. Keep boundaries strict. Measure demand. Extract only what needs to scale independently.**
