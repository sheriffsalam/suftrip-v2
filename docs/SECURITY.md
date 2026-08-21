# Suftrip Security

## Phase 4 controls

- PostgreSQL credentials are supplied through `DATABASE_URL`.
- `.env` and `.env.*` files remain ignored by Git.
- The checked-in Compose password is development-only.
- Database errors are translated to typed conflicts where applicable; PostgreSQL internals are not returned by the HTTP API.
- The Docker runtime uses the non-root `node` user.
- HTTP request bodies remain limited to 1 MB and are validated before application commands run.

## Phase 5 controls

- Delivery API routes require `Authorization: Bearer <token>`.
- Tokens are cryptographically verified with HS256 and require an environment-provided `AUTH_SECRET` of at least 32 characters.
- `CUSTOMER` and `ADMIN` are the supported roles.
- Customers can access only jobs they requested; administrators can access jobs across users.
- Delivery creation derives requester identity from the authenticated principal.
- Authentication failures return `401`; authorization failures return `403`.
- API responses include `nosniff`, `no-referrer`, and `no-store` headers.
- Dispatch creation and inspection use delivery ownership authorization. Provider acceptance/rejection requires the assigned provider principal or an administrator.

Rate limiting, audit logging, identity provisioning, token rotation, and external identity-provider integration remain future work. The current API is not production-ready without those controls.
