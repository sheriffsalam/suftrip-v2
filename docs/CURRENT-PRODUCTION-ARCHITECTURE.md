# Suftrip V2 — Current Low-Cost Production Architecture

## Purpose

This document defines the architecture that should be used to operate Suftrip as a real user-facing application while keeping infrastructure and operational cost deliberately low.

## Architecture

```text
                         INTERNET
                            |
                         HTTPS/TLS
                            |
                            v
                  +---------------------+
                  | Render Web Service  |
                  |                     |
                  | Static Web UI       |
                  | Public HTTP Server  |
                  | API                 |
                  | Application Layer   |
                  | Domain Layer        |
                  | Infrastructure      |
                  +----------+----------+
                             |
                           SQL/TLS
                             |
                             v
                  +---------------------+
                  | Managed PostgreSQL   |
                  |                     |
                  | Delivery state      |
                  | Dispatch state      |
                  | Payment state       |
                  | Outbox/queue state  |
                  | Idempotency state   |
                  +---------------------+
```

## Why this architecture is appropriate now

The platform does not yet need the cost and failure modes of a distributed microservice environment. The current workload can be handled efficiently by one horizontally scalable application process connected to PostgreSQL.

The key design decision is to keep **logical separation stronger than deployment separation**.

The code has bounded capabilities even though they share one process and database.

```text
Application
├── Delivery
├── Dispatch
├── Payments
├── Notifications
├── Authentication
└── Observability
```

A developer must not treat the shared database as permission to create arbitrary cross-module coupling.

## User request flow

```text
Browser
  |
  | HTTPS
  v
Public server
  |
  +--> Static UI
  |
  +--> /api/*
          |
          v
      Application use case
          |
          +--> Domain invariant
          |
          +--> Repository port
          |
          v
      PostgreSQL adapter
```

## Core reliability model

### Database transactions

Use PostgreSQL transactions when multiple state changes must succeed or fail together.

### Idempotency

Retry-sensitive commands must use an idempotency key or equivalent deterministic operation identity.

### Background work

Use the existing PostgreSQL-backed outbox/queue pattern for asynchronous work. Workers claim records using row locking and leases.

### At-least-once processing

Background processing must assume a message can be delivered more than once. Handlers therefore need idempotent effects.

## Scaling the current architecture

Scale in this order:

1. Optimize slow SQL and indexes.
2. Remove unnecessary database round trips.
3. Increase application instance capacity.
4. Add a second web instance when traffic requires it.
5. Tune background worker concurrency.
6. Add caching only for demonstrated hot reads.
7. Upgrade PostgreSQL resources.
8. Add read replicas only when measured read pressure justifies them.
9. Extract a bounded capability only after its workload or ownership requires independent scaling.

## Cost controls

Avoid until justified:

- Kubernetes
- Kafka
- Redis clusters
- Service mesh
- Multiple cloud providers
- Separate databases for every module
- Dedicated observability platforms
- Multi-region infrastructure

Prefer:

- One application deployment
- One managed PostgreSQL database
- Database-backed jobs
- Platform-managed TLS
- Platform-managed deployment
- Horizontal application scaling
- Open-source instrumentation

## Production hardening checklist

Before real commercial launch:

- [ ] Replace demo authentication.
- [ ] Use managed production authentication/identity.
- [ ] Configure a strong rotated secret.
- [ ] Upgrade PostgreSQL from prototype/free storage.
- [ ] Enable automated backups.
- [ ] Define RPO/RTO.
- [ ] Add production error monitoring.
- [ ] Add metrics and alerting.
- [ ] Add audit logs for privileged operations.
- [ ] Integrate a real payment provider.
- [ ] Integrate verified notification providers.
- [ ] Configure domain and TLS policy.
- [ ] Define data retention and privacy policies.
- [ ] Perform load and failure testing.

## Operating principle

The current architecture is not a temporary throwaway system. It is the **first deployment topology of a modular platform**. Keep the modules clean so that deployment topology can change later without changing business semantics.
