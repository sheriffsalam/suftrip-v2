# Durable Event Outbox

Suftrip uses PostgreSQL as the durable boundary for domain events that must survive process failure.

## Transactional boundary

Delivery status changes produce domain events. The PostgreSQL delivery repository persists the aggregate mutation and its outbox rows in the same database transaction. A committed delivery change therefore cannot lose its corresponding outbox event because the application process exits after the aggregate commit.

## Processing model

The outbox is processed at least once. Workers claim rows with PostgreSQL row locking (`FOR UPDATE SKIP LOCKED`) and a time-limited lease. Expired processing leases are reclaimable by another worker. Successful publication transitions an event to `PUBLISHED`.

The publisher is an application port. The current phase deliberately does not introduce Kafka, RabbitMQ, or another broker. A concrete publisher can be added later without coupling domain code to infrastructure.

## Failure and retry

Publication failures increment the durable attempt count and return the event to `PENDING` with a future `available_at`. The worker uses bounded exponential backoff, capped at five minutes. Once the configured maximum attempt count is reached, the event becomes `DEAD_LETTER` and is excluded from normal claims. The original payload and failure reason remain available for recovery tooling.

## Delivery semantics

The system provides **at-least-once publication**, not exactly-once delivery. A worker can publish successfully and lose its lease before persisting `PUBLISHED`; another worker can then publish the same event. Consumers must therefore be idempotent using the stable event ID.

## Concurrency

Multiple workers may process independent events concurrently. PostgreSQL row locking prevents two workers from claiming the same eligible row at the same time. Lease expiry provides recovery from crashed workers.

## Observability

The worker emits structured events for successful publication, retry scheduling, and dead-lettering. Event payloads are not logged.
