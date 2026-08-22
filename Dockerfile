# Build image for the Suftrip V2 TypeScript/Node foundation.
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY test ./test

RUN npm ci --ignore-scripts
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/infrastructure/persistence/postgres/migrations ./src/infrastructure/persistence/postgres/migrations

USER node

CMD ["node", "dist/src/http/server.js"]
