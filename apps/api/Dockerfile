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
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @energy-manager/shared build
RUN pnpm --filter @energy-manager/api build

# One-off migration runner, used as the `migrate` service in docker-compose.yml.
FROM build AS migrate
WORKDIR /repo/apps/api
CMD ["pnpm", "db:migrate"]

FROM build AS runner
WORKDIR /repo/apps/api
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
