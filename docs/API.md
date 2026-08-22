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
- `POST /api/v1/delivery-jobs/:deliveryJobId/payments`
- `GET /api/v1/payments/:paymentId`
- `POST /api/v1/payments/:paymentId/initiate`
- `POST /api/v1/payments/:paymentId/confirm`
- `POST /api/v1/payments/:paymentId/fail`
- `POST /api/v1/payments/:paymentId/cancel`

The notification HTTP boundary is implemented as a composable server adapter with:

- `POST /api/v1/notifications`
- `GET /api/v1/notifications/:notificationId`
- `POST /api/v1/notifications/:notificationId/send`
- `POST /api/v1/notifications/:notificationId/retry`
- `POST /api/v1/notifications/:notificationId/cancel`

Notification creation and mutation operations require `Idempotency-Key`. Notification routes require bearer authentication and preserve the application-layer owner-or-admin authorization boundary. Notification operation responses expose the notification snapshot and, for send/retry, the delivery attempt.

All `/api/v1` endpoints require `Authorization: Bearer <token>`. `/health` remains public on the main API server.

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

Payment mutation endpoints require an `Idempotency-Key` header. Creation keys are unique for a payment obligation; operation keys are scoped to payment and operation. Repeating a request with the same valid key returns the original result. Payment creation, initiation, confirmation, failure, and cancellation require delivery ownership or administrator access.

## Notifications

`POST /api/v1/notifications`

```json
{
  "id": "notification-1",
  "recipientId": "customer-1",
  "channel": "IN_APP",
  "templateKey": "delivery.status.updated",
  "payload": {
    "deliveryId": "delivery-1",
    "message": "Your delivery is on the way"
  }
}
```

The client must supply `Idempotency-Key`. Customers may create notifications for themselves; administrators may create them for other recipients. Notification send/retry/cancel operations also require an idempotency key and are protected by the same owner-or-admin authorization rule.

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

Pagination and OpenAPI publication are not implemented yet. Real gateway callbacks, external payment processing, and financial settlement are deferred.
