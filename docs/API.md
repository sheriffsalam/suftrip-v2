# Suftrip API

## Implemented

The current HTTP API exposes:

- `GET /health`
- `POST /api/v1/delivery-jobs`
- `GET /api/v1/delivery-jobs/:id`
- `PATCH /api/v1/delivery-jobs/:id/status`
- `POST /api/v1/delivery-jobs/:deliveryJobId/dispatch`
- `GET /api/v1/dispatch-jobs/:dispatchJobId`
- `POST /api/v1/dispatch-jobs/:dispatchJobId/assign`
- `POST /api/v1/dispatch-jobs/:dispatchJobId/accept`
- `POST /api/v1/dispatch-jobs/:dispatchJobId/reject`
- `POST /api/v1/dispatch-jobs/:dispatchJobId/cancel`
- `POST /api/v1/providers` (administrator only, test/provisioning foundation)

All `/api/v1/delivery-jobs` endpoints require `Authorization: Bearer <token>`. `/health` remains public.

Every response includes `x-request-id`. Clients may provide that header; otherwise the server generates one.

Delivery-job responses are HTTP DTOs containing the delivery job fields. They do not expose the domain aggregate instance.

## Create delivery job

`POST /api/v1/delivery-jobs`

Required fields:

- `pickup.address`, `pickup.latitude`, `pickup.longitude`
- `dropoff.address`, `dropoff.latitude`, `dropoff.longitude`
- `deliveryType`: `PARCEL`, `FOOD`, `DOCUMENT`, or `OTHER`

The optional `id` is generated when omitted. The authenticated principal supplies `requesterId`; a client-supplied `requesterId` is ignored.

Customers can access their own delivery jobs. Administrators can access delivery jobs across users.

Customers can create and view dispatch jobs for their own deliveries and request assignment. Assigned providers can accept or reject their own assignments. Administrators can provision providers and perform dispatch operations.

## Change status

`PATCH /api/v1/delivery-jobs/:id/status`

```json
{
  "expectedVersion": 0,
  "nextStatus": "REQUESTED"
}
```

## Errors

Errors use this shape:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "...",
    "requestId": "..."
  }
}
```

Current mappings are authentication `401`, authorization `403`, validation `400`, not found `404`, conflicts `409`, invalid transitions `422`, and unexpected failures `500`.

## Proposed

Idempotency keys, pagination, and OpenAPI publication are not implemented yet. Authentication and ownership authorization are implemented in Phase 5. Idempotency remains reserved for future mutating commands before financial operations are introduced.
