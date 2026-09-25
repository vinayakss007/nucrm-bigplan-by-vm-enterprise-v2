# ── Multi-stage build for speed & size ────────────────────

# Stage 1: Dependencies
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# Stage 2: Builder
FROM node:26-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Non-sensitive build args — safe to store in image history
ARG DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ARG SENTRY_DSN=""
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG SENTRY_ENVIRONMENT="production"
ARG SENTRY_RELEASE=""
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
# Added for pre-prod deploys. Defaults reproduce the original behaviour exactly,
# so upstream builds are unaffected when these are not passed.
#   NEXT_PUBLIC_APP_URL — was hardcoded to http://localhost:3000 below, which
#     bakes a wrong absolute URL into the bundle for any non-localhost deploy
#     (breaks password-reset emails, OAuth redirects and invites via
#     lib/app-url.ts::getAppUrl()).
#   NODE_OPTIONS — the `Running TypeScript ...` step of `next build` exceeds
#     Node's ~2GB default heap on this codebase and dies with
#     "Ineffective mark-compacts near heap limit". Raise max-old-space-size here.
ARG NEXT_PUBLIC_APP_URL="http://localhost:3000"
ARG NODE_OPTIONS=""
# Sensitive values passed via BuildKit secret mounts (not in image history)
# --mount=type=secret requires: DOCKER_BUILDKIT=1 or docker buildx build
RUN --mount=type=secret,id=jwt_secret \
    --mount=type=secret,id=sentry_auth_token \
    DATABASE_URL=$DATABASE_URL \
    JWT_SECRET=$(cat /run/secrets/jwt_secret 2>/dev/null || echo "build-only-not-runtime") \
    SENTRY_DSN=$SENTRY_DSN \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    SENTRY_ENVIRONMENT="$SENTRY_ENVIRONMENT" \
    NEXT_PUBLIC_SENTRY_ENVIRONMENT="$SENTRY_ENVIRONMENT" \
    SENTRY_RELEASE="$SENTRY_RELEASE" \
    NEXT_PUBLIC_SENTRY_RELEASE="$SENTRY_RELEASE" \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT \
    SENTRY_AUTH_TOKEN=$(cat /run/secrets/sentry_auth_token 2>/dev/null) \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NODE_OPTIONS="$NODE_OPTIONS" \
    npm run build && \
    echo "build-$(date +%s)" > /app/.next/BUILD_ID

# Stage 3: Runner (minimal)
FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create a dedicated non-root user and group
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

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
# realtime.ts is the socket.io server that nginx proxies /socket.io/ to
# (`upstream nucrm_realtime { server realtime:4001; }` in nginx-production.conf).
# It was shipped to no image at all: the dev compose starts it from the repo, and
# this runner stage copied worker.ts but not realtime.ts, so a `docker run
# nucrm-app:preprod node --import tsx realtime.ts` fails with MODULE_NOT_FOUND.
COPY --from=builder /app/realtime.ts ./realtime.ts

# Set ownership of app directory to the non-root user
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

# Memory-limited start - prevents OOM on 4GB machines
ENV NODE_OPTIONS="--max-old-space-size=2048"
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1
CMD ["npm", "run", "prod:start:custom"]
