# Suftrip V2 — Future Microservice Architecture

## Objective

This is the target architecture for a mature Suftrip platform when traffic, team size, reliability requirements or regulatory needs justify independent services.

Microservices are an **evolutionary destination**, not the starting point.

## Target topology

```text
                         USERS / PARTNERS
                                |
                           CDN / WAF
                                |
                         API Gateway / BFF
                                |
        +-----------------------+-----------------------+
        |                       |                       |
        v                       v                       v
 Delivery Service       Dispatch Service       Identity Service
        |                       |                       |
   Delivery DB             Dispatch DB             IdP
        |                       |                       |
        +-----------------------+-----------------------+
                                |
                         Event Backbone
                                |
          +---------------------+----------------------+
          |                     |                      |
          v                     v                      v
   Payment Service      Notification Service     Tracking Service
          |                     |                      |
     Payment DB             Notify DB              Track DB
          |
   External PSP
```

## Service ownership

### Delivery Service

Owns:

- DeliveryJob aggregate
- pickup/dropoff information
- delivery lifecycle
- customer-facing delivery commands
- delivery status events

Must not own provider assignment algorithms or payment processor state.

### Dispatch Service

Owns:

- provider availability
- dispatch jobs
- assignment
- provider state
- dispatch optimization

### Payment Service

Owns:

- payment intent
- payment attempt
- processor integration
- webhook verification
- reconciliation
- refunds
- payment audit trail

This service should receive the strongest security controls because it handles financial operations.

### Notification Service

Owns:

- notification templates
- delivery channels
- notification attempts
- retry policy
- provider adapters
- customer notification preferences

### Tracking Service

Owns high-frequency location and tracking data when that workload becomes significant. Do not put GPS streams into the core Delivery database.

## Data ownership rule

The most important microservice rule is:

> **A service owns its data. Other services consume its API or events; they do not query its database.**

Cross-service reporting should use an analytics/read model rather than direct database joins.

## Communication strategy

Use synchronous HTTP for operations requiring an immediate response:

```text
Create delivery
Assign provider
Get payment status
Get delivery details
```

Use asynchronous events for side effects:

```text
DeliveryCreated
DeliveryAssigned
DeliveryPickedUp
DeliveryCompleted
PaymentAuthorized
PaymentFailed
```

## Event contract requirements

Every event should contain:

```json
{
  "eventId": "unique-id",
  "eventType": "DeliveryCompleted.v1",
  "occurredAt": "timestamp",
  "producer": "delivery-service",
  "aggregateId": "delivery-id",
  "schemaVersion": 1,
  "correlationId": "request-id",
  "payload": {}
}
```

Events are immutable. New fields should be backward compatible. Breaking changes require a new event version.

## Migration sequence

### 1. Stabilize monolith

- Test boundaries.
- Remove cross-module imports.
- Remove direct cross-module repository calls.
- Define ports.
- Define domain events.
- Add correlation IDs.
- Measure traffic and failure patterns.

### 2. Establish outbox

Every event-producing transaction writes business state and the event record in the same database transaction.

```text
BEGIN
  update business state
  insert outbox event
COMMIT
```

A publisher later forwards the event.

This prevents the classic failure where the database commits but event publication fails.

### 3. Extract Notifications

First because notifications are side effects and have limited impact on the core transaction path.

- Create service.
- Give it its own database.
- Consume delivery events.
- Implement idempotent event handling.
- Run in parallel with existing notification logic.
- Validate output.
- Switch production traffic.
- Remove old implementation.

### 4. Extract Dispatch

- Define provider/assignment API.
- Move ownership of provider availability.
- Create dispatch database.
- Publish provider/assignment events.
- Route assignment commands to Dispatch Service.
- Remove dispatch persistence from monolith.

### 5. Extract Payments

- Add real PSP adapter.
- Define payment API.
- Verify webhooks.
- Add idempotency.
- Add reconciliation.
- Add payment audit logs.
- Create dedicated payment database.
- Move payment operations.

### 6. Extract Delivery Core

Only after the surrounding services are proven independent.

The former monolith becomes the Delivery Service, then can be scaled and deployed independently.

### 7. Add Tracking if required

Tracking is a high-frequency workload and should be separated only when location updates materially affect database and application performance.

## Infrastructure evolution

### Small scale

```text
Render/Fly/AWS/GCP
  |
  +-- App
  +-- PostgreSQL
```

### Medium scale

```text
Cloud Load Balancer
   |
   +-- Delivery
   +-- Dispatch
   +-- Notification
   +-- Payment
   |
Managed PostgreSQL instances
```

### High scale

```text
CDN/WAF
   |
API Gateway
   |
Kubernetes or managed container platform
   |
Services + autoscaling
   |
Managed event streaming
   |
Service-owned databases
   |
Analytics platform
```

## When to introduce a broker

A broker such as Kafka should be introduced when there is a demonstrated requirement for high event throughput, replay, multiple independent consumers, partitioning or stream processing.

For lower throughput, a managed queue or PostgreSQL outbox/worker pattern is cheaper and easier to operate.

## When to introduce Kubernetes

Kubernetes becomes reasonable when:

- there are many independently deployed services;
- autoscaling requirements are complex;
- deployment frequency is high;
- multiple teams need platform autonomy;
- workload types require advanced scheduling;
- the organization can support Kubernetes operations.

It should not be introduced simply to make the architecture look enterprise-grade.

## Reliability targets

Define service-level objectives before designing redundancy.

Example:

| Capability | Initial target |
|---|---:|
| API availability | 99.9% |
| Delivery command success | 99.9% |
| Notification processing | 99% within agreed window |
| Payment webhook processing | 99.99% within agreed window |
| Data durability | Based on managed DB backup policy |

Actual targets should be agreed with management and product owners.

## Failure design

Assume:

- network calls fail;
- requests are duplicated;
- workers crash;
- events arrive out of order;
- dependencies become unavailable;
- deployments partially fail;
- databases become temporarily unavailable.

Therefore:

- commands are idempotent;
- consumers are idempotent;
- retries use bounded exponential backoff;
- dead-letter handling exists where appropriate;
- timeouts are explicit;
- circuit breaking is introduced for unstable external dependencies;
- data ownership is unambiguous.

## Final target principle

The mature architecture should optimize for **independent scaling and independent failure domains**, not maximum service count.
