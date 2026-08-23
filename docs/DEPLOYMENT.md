# Suftrip Deployment

## Local PostgreSQL

Start the database with:

```text
docker compose up -d postgres
npm run db:migrate
```

The development connection string is documented in `.env.example`. Set `DATABASE_URL` before starting the API:

```text
npm run build
npm start
```

The application does not create or mutate the schema during normal API startup. Required migrations must be applied explicitly.

## Free public prototype deployment

The repository includes `render.yaml` for a zero-cost prototype deployment on Render. It provisions:

- one free Node web service;
- one free PostgreSQL database;
- generated `AUTH_SECRET`;
- explicitly gated `DEMO_AUTH=true`;
- automatic database migration before startup;
- the API and browser frontend behind the same public HTTPS origin.

The public service runs `npm run start:public`. That launcher serves `web/` and proxies `/api/*` to the existing API server, so the frontend does not need a separate CORS configuration or a secret in browser JavaScript.

To deploy, connect `sheriffsalam/suftrip-v2` to Render and choose **Blueprint** using `render.yaml`. Render supports free web services and free PostgreSQL for testing/hobby use. The free PostgreSQL database is limited to 1 GB and expires after 30 days, so this is explicitly a prototype/testing deployment rather than a permanent production datastore.

After deployment, open the generated `onrender.com` URL. The frontend's **Enter customer demo** button uses the gated `demo:customer` credential. This credential is accepted only when `DEMO_AUTH=true` is present on the server.

## Production

Provide `DATABASE_URL` and `AUTH_SECRET` through the deployment secret/configuration system. `AUTH_SECRET` must be at least 32 characters and must be rotated through the deployment configuration process. Do not commit `.env` files or credentials. The current Dockerfile runs the Node process as the non-root `node` user.

The deterministic payment gateway and notification sender are intentionally local adapters. They do not charge real money or send real external notifications.
