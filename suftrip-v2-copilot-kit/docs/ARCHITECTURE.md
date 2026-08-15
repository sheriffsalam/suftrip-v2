# Suftrip V2 Architecture Baseline

## Product position
Suftrip is a multi-vertical logistics platform. Food delivery is one vertical. Chowdeck is a public benchmark, not a source of proprietary architecture.

## Core model
```mermaid
flowchart LR
    A[Parcel Request] --> J[DeliveryJob]
    B[Food Order] --> J
    C[Business Shipment] --> J
    D[Luggage / Relocation] --> J
    J --> P[Pricing]
    J --> Q[Quotes]
    J --> X[Dispatch]
    J --> T[Tracking]
    J --> Pay[Payment]
    X --> R[Rider / Provider]
    R --> T
```

## Delivery lifecycle
```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> REQUESTED
    REQUESTED --> QUOTING
    REQUESTED --> SEARCHING_FOR_PROVIDER
    QUOTING --> BOOKED
    SEARCHING_FOR_PROVIDER --> PROVIDER_ASSIGNED
    BOOKED --> PROVIDER_ASSIGNED
    PROVIDER_ASSIGNED --> PROVIDER_ACCEPTED
    PROVIDER_ACCEPTED --> ARRIVING_FOR_PICKUP
    ARRIVING_FOR_PICKUP --> PICKED_UP
    PICKED_UP --> IN_TRANSIT
    IN_TRANSIT --> ARRIVING
    ARRIVING --> DELIVERED
    REQUESTED --> CANCELLED
    QUOTING --> CANCELLED
    BOOKED --> CANCELLED
```

## Platform
```mermaid
flowchart TB
    C[Customer App] --> API[API]
    R[Rider App] --> API
    B[Business Portal] --> API
    A[Admin/Ops] --> API
    API --> ID[Identity]
    API --> LOG[Logistics]
    API --> COM[Commerce]
    API --> PAY[Payments]
    LOG --> PR[Pricing]
    LOG --> QU[Quotes]
    LOG --> DI[Dispatch]
    LOG --> TR[Tracking]
    API --> PG[(PostgreSQL)]
    API --> RED[(Redis)]
```

These are proposed V2 designs, not claims about current private Suftrip internals.
