# syntax=docker/dockerfile:1.7
#
# moulinator NestJS API — multi-stage build.
#
# pnpm workspace note: inside a pnpm workspace, `apps/api/node_modules` is a
# web of symlinks into the workspace-level `.pnpm` store. Copying that folder
# alone breaks module resolution at runtime. We use `pnpm deploy --prod` which
# materializes a self-contained, production-only dependency tree with real
# files (no symlinks into the workspace), safe to copy into a thin runtime.
#
# Source lands from the backend agents; this stub is tolerant of an empty
# workspace and must still `docker build` once they populate apps/api/src.

ARG NODE_VERSION=20.18-alpine

# -------- deps --------------------------------------------------------------
# Installs the FULL workspace (dev deps included) so we can run build steps.
FROM node:${NODE_VERSION} AS deps
WORKDIR /workspace

RUN apk add --no-cache libc6-compat openssl \
    && corepack enable \
    && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Root tsconfig.base.json is extended by apps/api/tsconfig.json; copying it
# here lets the build stage resolve the base config.
COPY tsconfig.base.json ./
# Copy every workspace package so pnpm resolves the graph.
COPY apps ./apps
COPY packages ./packages

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile


# -------- build -------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /workspace

RUN apk add --no-cache libc6-compat openssl \
    && corepack enable \
    && corepack prepare pnpm@9.12.0 --activate

COPY --from=deps /workspace /workspace

WORKDIR /workspace/apps/api
RUN pnpm exec prisma generate \
    && pnpm run build

# Produce a self-contained production tree at /workspace/deploy-api.
# `pnpm deploy` materializes the target package with real files (no symlinks
# into the workspace store), so the result is safe to copy into a thin
# runtime image without dragging in the pnpm store.
#   - --filter selects by package name (not path)
#   - --prod drops devDependencies
WORKDIR /workspace
RUN pnpm --filter @moulinator/api --prod deploy /workspace/deploy-api


# -------- runtime -----------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    API_PORT=3001

RUN apk add --no-cache tini openssl curl \
    && corepack enable \
    && corepack prepare pnpm@9.12.0 --activate \
    && addgroup -S moulinator \
    && adduser -S -G moulinator -h /app moulinator

# Copy the self-contained deploy tree (production deps + dist + package.json).
COPY --from=build --chown=moulinator:moulinator /workspace/deploy-api/ ./
# Prisma schema.
COPY --from=build --chown=moulinator:moulinator /workspace/apps/api/prisma ./prisma
# `pnpm --prod deploy` strips devDependencies and does NOT reproduce the
# `node_modules/.prisma` symlink the dev tree has. Install the Prisma CLI
# globally so we can (a) regenerate the client inside the production
# node_modules layout at build time and (b) run `migrate deploy` at boot.
# Regenerating at build time means the runtime container starts with no
# network dependency on npmjs or the Prisma binary CDN.
RUN npm install --no-save --global prisma@5.22.0 \
 && prisma generate --schema=./prisma/schema.prisma \
 && chown -R moulinator:moulinator /app

USER moulinator
# API_PORT is read by apps/api/src/main.ts (default 3001 when unset).
EXPOSE 3001

# TCP-level readiness probe — backend-crud has not added a /healthz route yet,
# and a TCP check is the tightest signal that matches what the Nest app
# actually does (calls `.listen()` on API_PORT). Swap to an HTTP probe on
# /healthz once that route lands.
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=4 \
  CMD node -e "require('net').createConnection(Number(process.env.API_PORT||3001),'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
# Runs pending migrations at boot, then starts the server.
# Nest's tsc output is nested when tsconfig `include` spans outside src/ (it
# does in this workspace because paths maps into ../../packages), so the
# compiled entry lives at dist/apps/api/src/main.js rather than dist/main.js.
# If backend-crud flattens that later, update the CMD in lockstep.
CMD ["sh", "-c", "prisma migrate deploy --schema=./prisma/schema.prisma && node dist/apps/api/src/main.js"]
