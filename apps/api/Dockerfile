FROM node:20-alpine AS builder
WORKDIR /app

# Instala pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copia manifests do monorepo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json     packages/shared/
COPY packages/domain/package.json     packages/domain/
COPY apps/api/package.json            apps/api/

RUN pnpm install --frozen-lockfile

# Copia código-fonte
COPY packages/shared     packages/shared
COPY packages/domain     packages/domain
COPY apps/api            apps/api

# Build
RUN pnpm --filter @nutriplan/shared build
RUN pnpm --filter @nutriplan/domain build
RUN pnpm --filter api build

# ─── Runtime ───────────────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json        apps/api/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/domain/dist packages/domain/dist
COPY --from=builder /app/apps/api/dist        apps/api/dist

EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
