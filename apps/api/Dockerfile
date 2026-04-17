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
# Copy every workspace package.json so pnpm resolves the graph. Using a wildcard
# keeps this generic across the monorepo — adjust when the layout stabilises.
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
# --legacy is required when the repo's pnpm-workspace.yaml uses default
# hoisting; it makes node_modules real-files, not symlinks into the store.
WORKDIR /workspace
RUN pnpm --filter ./apps/api --prod --legacy deploy /workspace/deploy-api


# -------- runtime -----------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

RUN apk add --no-cache tini openssl curl \
    && corepack enable \
    && corepack prepare pnpm@9.12.0 --activate \
    && addgroup -S moulinator \
    && adduser -S -G moulinator -h /app moulinator

# Copy the self-contained deploy tree. It already contains package.json +
# node_modules with real files + dist (because pnpm deploy copies the whole
# package directory, including the compiled output).
COPY --from=build --chown=moulinator:moulinator /workspace/deploy-api/ ./
# Prisma schema is needed for `migrate deploy` at container boot.
COPY --from=build --chown=moulinator:moulinator /workspace/apps/api/prisma ./prisma

USER moulinator
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=4 \
  CMD curl -fsS http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
