# ADR-005: Authentication and Authorization Boundary

## Status

Accepted for Phase 5.

## Decision

Keep authentication behind `AuthenticationPort` and use an environment-secret HS256 bearer-token adapter for this phase. Represent authenticated identity as a small principal containing `userId` and `CUSTOMER` or `ADMIN` roles.

Authorize delivery access in application services: customers may access only jobs whose `requesterId` matches their principal, while administrators may access jobs across users. Delivery creation always derives requester identity from the principal.

## Rationale

This establishes a replaceable authentication boundary without adding an identity database or external provider. It keeps HTTP parsing separate from cryptographic validation and keeps ownership decisions out of the domain and persistence adapter.

## Deferred

User registration, password login, token rotation, external identity providers, rate limiting, audit logging, and distributed security infrastructure are deferred.
