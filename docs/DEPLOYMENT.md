# Suftrip Deployment

## Local PostgreSQL

Start the database with:

```text
docker compose up -d postgres
npm run db:migrate
```

The development connection string is documented in `.env.example`. Set `DATABASE_URL` in the process environment before starting the API:

```text
npm run build
npm start
```

The application does not create or mutate the schema during startup. Required migrations must be applied explicitly.

Phase 6 adds `providers` and `dispatch_jobs` through migration `002-create-dispatch`. The same `DATABASE_URL` and PostgreSQL service are used; no separate dispatch database is required.

## Production

Provide `DATABASE_URL` and `AUTH_SECRET` through the deployment secret/configuration system. `AUTH_SECRET` must be at least 32 characters and must be rotated through the deployment configuration process. Do not commit `.env` files or credentials. The current Dockerfile runs the Node process as the non-root `node` user.
