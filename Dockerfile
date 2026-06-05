# ── Multi-stage build for speed & size ────────────────────

# Stage 1: Dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps --no-audit --no-fund 2>&1 | tail -5

# Stage 2: Builder
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ARG DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ARG JWT_SECRET="build-jwt-secret"
ARG SENTRY_DSN=""
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
ARG SENTRY_AUTH_TOKEN=""
RUN DATABASE_URL=$DATABASE_URL \
    JWT_SECRET=$JWT_SECRET \
    SENTRY_DSN=$SENTRY_DSN \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT \
    SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN \
    NEXT_PUBLIC_APP_URL=http://localhost:3000 \
    npm run build && \
    echo "build-$(date +%s)" > /app/.next/BUILD_ID

# Stage 3: Runner (minimal)
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./
COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/worker.ts ./worker.ts

EXPOSE 3000

# Memory-limited start — prevents OOM on 4GB machines
ENV NODE_OPTIONS="--max-old-space-size=2048"
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1
CMD ["npm", "run", "prod:start:custom"]
