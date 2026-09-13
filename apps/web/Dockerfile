# syntax=docker/dockerfile:1
FROM node:26-slim AS base
WORKDIR /repo
# Node 26 no longer bundles corepack (bin/ has only node, npm, npx), so it has
# to be installed before it can be enabled. Enabling it rather than installing
# pnpm directly keeps package.json's "packageManager" field the single source
# of truth for the pnpm version, matching CI.
RUN npm install -g corepack && corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @energy-manager/shared build
RUN pnpm --filter @energy-manager/web build

FROM nginx:1.27-alpine AS runner
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template

# Where this container forwards /api/ requests. Defaults to a container named
# `api` on the same user-defined Docker network, which is what the compose
# files create. Override it to point at any name, IP or port — e.g.
#   -e API_UPSTREAM=http://EnergyManager-api:3000
#   -e API_UPSTREAM=http://10.0.0.10:3000
# so the API container is not forced to be called `api`.
ENV API_UPSTREAM=http://api:3000
# Restrict envsubst to this one variable; see nginx.conf.template.
ENV NGINX_ENVSUBST_FILTER=^API_UPSTREAM$

EXPOSE 80
