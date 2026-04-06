FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY tsconfig.base.json ./
COPY apps/gateway/package.json apps/gateway/

RUN pnpm install --frozen-lockfile

COPY apps/gateway apps/gateway

RUN pnpm --filter gateway build

# ─── Runtime ───────────────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/gateway/package.json apps/gateway/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/apps/gateway/dist apps/gateway/dist

EXPOSE 8080
CMD ["node", "apps/gateway/dist/main.js"]
