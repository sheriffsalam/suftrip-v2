FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY test ./test

RUN npm ci --ignore-scripts
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/infrastructure/persistence/postgres/migrations ./src/infrastructure/persistence/postgres/migrations

USER node

CMD ["node", "dist/src/http/server.js"]
