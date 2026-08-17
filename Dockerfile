# Runtime image for the Suftrip V2 TypeScript/Node foundation.
# Dependencies and compilation remain explicit so the image cannot silently
# substitute an undeclared build toolchain.
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
COPY test ./test

RUN npm install --ignore-scripts
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY --from=build /app/dist ./dist

USER node

CMD ["node", "dist/src/runtime.js"]
