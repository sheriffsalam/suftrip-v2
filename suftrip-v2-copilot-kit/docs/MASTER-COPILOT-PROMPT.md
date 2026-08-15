# SUFTRIP V2 — MASTER GITHUB COPILOT BUILD PROMPT

## ROLE
Act as the principal software architect and senior full-stack engineer for Suftrip V2.

Build incrementally. Inspect before modifying. Never invent facts about Suftrip's private implementation.

## PRODUCT
Suftrip is a **multi-vertical logistics platform**. Logistics remains the core product. Food delivery is one extensible vertical.

Use public products such as Chowdeck only as UX/operational benchmarks. Do not copy proprietary code, branding, assets, or claim knowledge of proprietary architecture.

Verified product direction includes delivery requests, logistics providers, provider quotes, quote comparison, booking, payment and real-time tracking. Anything beyond verified public information is a V2 design proposal.

## CORE ABSTRACTION
Use `DeliveryJob` as the reusable logistics abstraction.

Examples:
- ParcelRequest -> DeliveryJob
- FoodOrder -> DeliveryJob
- BusinessShipment -> DeliveryJob
- LuggageRequest -> DeliveryJob

DeliveryJob should support requester, merchant/business when applicable, pickup, destination, items/package details, pricing, quotes, assignment, provider, status, ETA, tracking, proof of delivery, payment, cancellation and audit history.

## DELIVERY MODES
Support:
1. Marketplace/quote mode: request -> provider quotes -> compare -> select -> pay -> dispatch -> track -> deliver.
2. Instant mode: pickup/destination -> price -> dispatch -> provider -> track -> deliver.

Both converge on DeliveryJob.

## FOOD VERTICAL
Restaurant -> Menu -> Cart -> FoodOrder -> DeliveryJob -> Dispatch -> Rider -> Tracking -> Delivery.

Do not put restaurant-specific rules into the generic logistics engine.

## USERS
Customer, Provider/Rider, Business, Business Staff, Admin, Operations Agent, Support Agent.

Use backend RBAC and resource-level authorization.

## ARCHITECTURE
Start as a **modular monolith**, not premature microservices.

Core modules:
Identity, Customers, Providers, Businesses, Logistics, Quotes, Pricing, Dispatch, Tracking, Payments, Notifications, Food, Ratings, Support, Administration, Audit.

Keep domain logic separate from HTTP, persistence, external SDKs and message transport.

Use adapters/interfaces such as:
PaymentProvider, MapsProvider, NotificationProvider, StorageProvider, RoutingProvider.

## TECHNOLOGY BASELINE
Prefer:
- React Native + Expo
- Next.js
- TypeScript
- NestJS
- REST + WebSockets
- PostgreSQL
- Redis
- Docker / Compose
- Terraform
- GitHub Actions
- OpenTelemetry
- Prometheus / Grafana

Use another technology only when justified in an ADR.

## DATABASE
PostgreSQL is the system of record.

Model at minimum:
users, roles, profiles, providers, businesses, vehicles, addresses, delivery_jobs, delivery_items, quotes, assignments, tracking_sessions, location_samples, payments, refunds, settlements, ratings, notifications, audit_events.

Use UUIDs, timestamps, foreign keys, indexes, unique/check constraints and concurrency controls where appropriate.

## DELIVERY STATE MACHINE
Centralize transitions.

Baseline:
DRAFT -> REQUESTED -> QUOTING -> BOOKED -> SEARCHING_FOR_PROVIDER -> PROVIDER_ASSIGNED -> PROVIDER_ACCEPTED -> ARRIVING_FOR_PICKUP -> PICKED_UP -> IN_TRANSIT -> ARRIVING -> DELIVERED

Terminal states may include CANCELLED, FAILED and EXPIRED.

Every transition must validate state and actor, be appropriately idempotent, create an audit event and publish required events.

## PRICING
Create a reusable deterministic pricing engine. Do not put pricing rules in controllers.

Conceptually:
base + distance + vehicle + package/weight + urgency + zone + waiting - discounts.

Persist the pricing inputs/calculation version used for historical explainability.

## QUOTES
Quote is a first-class entity with provider, amount, currency, ETA, expiry, terms, status and timestamps.

Reject expired, duplicate or unauthorized acceptance.

## DISPATCH
Create a dedicated dispatch component.

Initial deterministic ranking may use availability, distance, ETA, vehicle suitability, package constraints, workload, zone and provider reliability.

Use a `DispatchStrategy` abstraction. AI must not be required for core correctness.

## REAL-TIME TRACKING
Provider GPS -> location gateway -> validation -> realtime state/event processing -> persistence where appropriate.

Customer/admin receive status, location and ETA through realtime channels.

Do not blindly persist every GPS sample. Use sensible sampling, throttling and retention.

## PAYMENTS
Use a `PaymentProvider` abstraction.

Webhook processing must be authenticated, signature-verified, idempotent, replay-safe and auditable.

Keep payment state separate from delivery state.

## SECURITY
Implement secure authentication, RBAC, resource authorization, validation, rate limiting, secret management, webhook verification, audit logs, least privilege and dependency/security checks.

Never expose secrets, payment credentials, sensitive location data or internal stack traces.

## API
Use `/api/v1/...`.

Provide consistent errors, pagination, validation, filtering, sorting, OpenAPI documentation, correlation IDs and idempotency for critical commands such as booking, payment initiation, webhooks and cancellation.

## EVENTS
Use events where asynchronous processing is useful, e.g.:
DeliveryRequested, QuoteSubmitted, QuoteAccepted, DeliveryBooked, ProviderAssigned, ProviderAccepted, PickupCompleted, DeliveryStarted, LocationUpdated, DeliveryCompleted, DeliveryCancelled, PaymentSucceeded, PaymentFailed.

Version and document events. Do not introduce infrastructure merely for fashion.

## TESTING — MANDATORY
Every feature requires tests.

Unit:
- pricing
- quote lifecycle
- state machine
- dispatch scoring
- permissions
- payment state
- cancellation
- ETA
- provider eligibility

Integration:
- API + PostgreSQL
- Redis
- delivery creation
- quote lifecycle
- payment webhook
- dispatch/assignment
- tracking
- notifications

E2E:
customer creates delivery -> price/quote -> books -> provider assigned -> tracking -> completion.

Also test payment failure, duplicate webhook, provider rejection, no provider, expired quote, unauthorized access, stale booking, invalid state transition, duplicate request and cancellation.

Never weaken/delete tests just to pass.

## DOCUMENTATION — MANDATORY
Maintain:
README.md
docs/ARCHITECTURE.md
docs/DOMAIN-MODEL.md
docs/API.md
docs/SECURITY.md
docs/TESTING.md
docs/DEPLOYMENT.md
docs/OBSERVABILITY.md
docs/DISPATCH.md
docs/PAYMENTS.md
docs/DECISIONS/

Use ADRs for important decisions.

For each major module document responsibility, dependencies, interfaces, invariants, failure modes and tests.

## DIAGRAMS
Create Mermaid diagrams for:
system context, container architecture, module architecture, delivery lifecycle, quote workflow, instant delivery, food-to-DeliveryJob, dispatch, tracking, payments, events, ERD, deployment, CI/CD and AI architecture.

Diagrams must reflect actual implementation, not imaginary components.

## CODE EXPLANATIONS
For each major milestone explain:
what was built, why, important modules/classes, data flow, errors, security, tests and extension points.

Do not waste time explaining trivial lines.

## DEVOPS
Create Dockerfiles, local Compose, environment templates, CI, lint, format, typecheck, tests, build and security/dependency checks.

Never commit real secrets.

Evolve:
Local -> CI -> Staging -> Production -> Kubernetes when justified.

## AI
AI is an optimization layer, not transactional authority.

Potential future capabilities:
ETA prediction, route optimization, demand forecasting, provider recommendation, anomaly detection and batching.

AI must be observable, versioned, bounded by deterministic constraints and safely degradable. Core logistics must work if AI is unavailable.

## IMPLEMENTATION PROCESS
For every slice:
1. inspect;
2. state objective;
3. identify files;
4. explain design;
5. implement;
6. test;
7. run tests;
8. fix failures;
9. update docs;
10. update diagrams;
11. summarize.

Do not rewrite unrelated code.

## PHASES
Phase 0 Discovery — NO application coding.
Phase 1 Foundation.
Phase 2 Identity.
Phase 3 Logistics Core.
Phase 4 Pricing.
Phase 5 Marketplace/Quotes.
Phase 6 Booking/Payments.
Phase 7 Dispatch.
Phase 8 Tracking.
Phase 9 Business Logistics.
Phase 10 Food Vertical.
Phase 11 Operations.
Phase 12 AI.
Phase 13 Production Hardening.

## FIRST ACTION
When this prompt is first used:
DO NOT CODE.

Perform Phase 0 and return:
1. repository audit
2. known facts
3. unknowns
4. assumptions
5. proposed architecture
6. repository structure
7. domain model
8. initial ERD
9. API outline
10. event outline
11. test strategy
12. security risks
13. DevOps strategy
14. implementation phases
15. risks/trade-offs

Then STOP and wait for approval.

# END
