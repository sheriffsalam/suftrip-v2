# Suftrip Domain Model

## Implemented

`DeliveryJob` remains the logistics request aggregate. Dispatch references it by ID and does not own delivery lifecycle state.

`DispatchJob` represents one provider-fulfilment workflow with:

- `id`
- `deliveryJobId`
- `status`
- `assignedProviderId`
- `attempt`
- `version`
- `createdAt`
- `updatedAt`

Dispatch states are `PENDING`, `SEARCHING`, `PROVIDER_ASSIGNED`, `PROVIDER_ACCEPTED`, `PROVIDER_REJECTED`, `COMPLETED`, and `CANCELLED`. Creation persists `PENDING` and requests search in the same application operation. Provider rejection releases the provider and allows an explicit redispatch.

`Provider` is intentionally minimal: ID, availability, coordinates, version, and timestamps. Matching considers only `AVAILABLE` providers and uses straight-line geodesic distance with provider ID as a deterministic tie-breaker.

## Proposed/deferred

Provider profiles, vehicles, eligibility requirements beyond availability, routing distance, ETA, live location, and external provider systems are not implemented.
