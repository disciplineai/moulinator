# syntax=docker/dockerfile:1.7
#
# moulinator Next.js web — multi-stage build.
#
# Uses Next.js `output: 'standalone'` so the runtime image ships only the
# compiled server + its pruned node_modules tree emitted by Next.js itself.
# That tree has no pnpm-symlink dependency on the workspace — Next copies the
# real files — so we don't need `pnpm deploy` here.

ARG NODE_VERSION=20.18-alpine

# -------- deps --------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /workspace

RUN apk add --no-cache libc6-compat \
    && corepack enable \
    && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Root TS config extended by apps/web/tsconfig.json; openapi.yaml is an input
# to the web app's `prebuild` step which regenerates the typed client.
COPY tsconfig.base.json ./
COPY openapi.yaml ./
COPY apps ./apps
COPY packages ./packages

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile


# -------- build -------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /workspace

RUN apk add --no-cache libc6-compat \
    && corepack enable \
    && corepack prepare pnpm@9.12.0 --activate

# NEXT_PUBLIC_* vars are burned in at build time; keep the set small.
# PUBLIC_API_URL is also exposed at build time because Next.js may reference
# it from next.config.js (rewrites target).
ARG NEXT_PUBLIC_API_URL
ARG PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    PUBLIC_API_URL=${PUBLIC_API_URL}

COPY --from=deps /workspace /workspace

WORKDIR /workspace/apps/web
# Ensure the optional public/ dir exists before Next's build so the runtime
# COPY never trips on a missing source tree. Safe if it already exists.
RUN mkdir -p public && pnpm run build


# -------- runtime -----------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache tini curl \
    && addgroup -S moulinator \
    && adduser -S -G moulinator -h /app moulinator

# Next standalone output layout mirrors the workspace: the server.js that we
# start is at apps/web/server.js inside the standalone tree.
COPY --from=build --chown=moulinator:moulinator /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=moulinator:moulinator /workspace/apps/web/.next/static ./apps/web/.next/static
# `public/` is optional — the build stage ensures it exists (even if empty)
# so this COPY is always valid.
COPY --from=build --chown=moulinator:moulinator /workspace/apps/web/public ./apps/web/public

USER moulinator
EXPOSE 3000

# TCP-level probe — Next.js standalone server starts listening on $PORT before
# any page compiles, so the check passes as soon as the process is live.
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=4 \
  CMD node -e "require('net').createConnection(Number(process.env.PORT||3000),'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
