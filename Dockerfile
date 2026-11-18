# syntax=docker/dockerfile:1
#
# The town in a container. Build with `docker compose build`; see docker-compose.yml and the README.
# Node runs the TypeScript directly, so the only build step is the watch page.

ARG NODE_VERSION=24

# ---- build: compile the SQLite driver, build the watch page, then drop the dev tools ----
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 is a native module; these build it when no prebuilt binary fits.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:web && npm prune --omit=dev

# ---- run: code owned by root and read-only to the town; only /app/data is writable ----
FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8787
# The login page answers without a session, so it shows the server is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/login').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/main.ts"]
