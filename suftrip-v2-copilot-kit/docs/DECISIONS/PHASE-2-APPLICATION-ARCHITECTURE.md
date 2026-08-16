# Phase 2 — Application Architecture Decisions

**Status:** APPROVED / LOCKED  
**Scope:** Application-layer architecture only  
**Implementation:** Not yet authorized by this document

## Purpose

This document records the human-approved Phase 2 application-layer decisions. It is a design contract for subsequent implementation and must not be treated as evidence of implementation that does not yet exist in the repository.

## Approved decisions

1. **Service orchestration / domain invariants** — Application services orchestrate use cases; the domain enforces its invariants.
2. **Use-case granularity** — One application use case per meaningful business operation.
3. **Authorization boundary** — Application services resolve role/resource authorization; domain logic independently enforces ownership and invariant rules.
4. **Idempotency** — Relevant commands must be idempotent.
5. **Transaction boundary** — A use case defines its application transaction boundary.
6. **Aggregate coordination** — Application services may coordinate multiple aggregates without moving business invariants into the service layer.
7. **Domain events** — Significant state changes produce domain events.
8. **Application errors** — Application-facing failures use explicit, categorized error contracts rather than leaking infrastructure exceptions.
9. **Commands and queries** — Commands and queries have separate application contracts.
10. **Persistence boundary** — Persistence is accessed through application/domain repository abstractions rather than directly from use-case callers.
11. **External services** — External systems are accessed through explicit application ports/interfaces; concrete SDKs remain in infrastructure adapters.
12. **Event handling** — Application-layer event handlers coordinate follow-up use cases; domain events remain independent of frameworks and infrastructure.
13. **Authorization failure boundary** — Application authorization may reject an operation before domain execution, but successful authorization never bypasses domain invariants.
14. **Authorization context** — Authorization evaluation uses an explicit context containing authenticated identity, resolved roles, and relevant business membership/resource scope, subject to the approved Phase 1 identity semantics.
15. **Concurrency conflicts** — Conflicting concurrent aggregate updates must produce an explicit conflict rather than silently overwriting state.
16. **Transactional event publication** — Aggregate state change and domain-event production belong to the same application transaction contract. Reliable transport/publication mechanics remain an infrastructure concern.
17. **AI authority boundary** — AI may analyze, recommend, plan, and prepare actions, but is never an authoritative identity or authorization principal for irreversible transactional operations.
18. **Observability boundary** — Significant use-case execution and security-sensitive outcomes expose structured observability/audit information without coupling domain logic to a specific observability platform.
19. **Application-layer scope** — The application layer exposes business use cases only. Domain internals, persistence operations, and infrastructure-specific operations are not application use-case contracts.

## Explicit non-decisions

This record does **not** select or prescribe:

- a database implementation;
- a message broker or queue;
- synchronous versus asynchronous event transport;
- optimistic versus pessimistic locking;
- a payment provider;
- an identity provider;
- a logging/monitoring vendor;
- API framework details;
- deployment infrastructure.

Those remain implementation/infrastructure decisions unless separately approved.

## Relationship to Phase 1

Phase 2 depends on the human-approved Phase 1 identity, role, membership, ownership, privacy, audit, payment-authorization, and identity-security decisions. This document does not redefine those decisions or invent missing identity semantics.

## Evidence boundary

The current repository is a design baseline. This document records approved architecture; it does not claim that the corresponding application services, domain models, authorization implementation, repositories, or infrastructure adapters already exist.

Before implementation, the actual repository contents must be inspected and the design must be reconciled against what is present. Any contradiction must be surfaced rather than resolved by assumption.

## Implementation gate

**Phase 2 design: APPROVED / LOCKED.**

**Implementation gate: separate.**

Implementation may begin only after the next implementation-evidence/design gate explicitly authorizes it.
