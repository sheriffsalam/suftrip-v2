# Suftrip V2 Testing Strategy

## Critical scenarios
- valid/invalid delivery creation
- state transition validation
- cancellation
- idempotency
- quote creation/expiry/acceptance
- duplicate quote acceptance
- payment success/failure
- duplicate and forged payment webhooks
- provider eligibility
- provider rejection
- no provider available
- realtime location authorization
- unauthorized resource access
- rate limiting
- sensitive data leakage

## Definition of done
Implementation + tests + lint + typecheck + build + security review + documentation + matching diagrams.
