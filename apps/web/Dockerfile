# Web (Next.js, режим standalone). Збирається з кореня монорепо:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_SITE_URL=https://voltstar.ua -t voltstar-web .
# NEXT_PUBLIC_* вшиваються під час збірки, тож образ збирається окремо для кожного середовища.

# ─── Build stage ───────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter @voltstar/web...

# Публічна адреса сайту: API доступний на тому ж домені під /api (reverse-proxy).
ARG NEXT_PUBLIC_SITE_URL=http://localhost
ARG NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_SITE_URL}
ARG NEXT_PUBLIC_LEGAL_NAME="ТОВ «ВОЛЬТСТАР»"
ARG NEXT_PUBLIC_LEGAL_EDRPOU=""
ARG NEXT_PUBLIC_PRIVACY_EMAIL="privacy@voltstar.ua"
# Звіти про помилки браузера (необовʼязково) і версія для них.
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=""
ARG APP_VERSION=dev
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_LEGAL_NAME=${NEXT_PUBLIC_LEGAL_NAME} \
    NEXT_PUBLIC_LEGAL_EDRPOU=${NEXT_PUBLIC_LEGAL_EDRPOU} \
    NEXT_PUBLIC_PRIVACY_EMAIL=${NEXT_PUBLIC_PRIVACY_EMAIL} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_SENTRY_ENVIRONMENT=${NEXT_PUBLIC_SENTRY_ENVIRONMENT} \
    NEXT_PUBLIC_APP_VERSION=${APP_VERSION} \
    NEXT_STANDALONE=true \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @voltstar/web build

# ─── Runtime stage ─────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    APP_VERSION=${APP_VERSION}
RUN addgroup -S app && adduser -S app -G app
# standalone містить лише потрібні для рантайму файли й залежності (трасування з кореня монорепо).
COPY --from=build --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /app/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/uk >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
