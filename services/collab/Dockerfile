# BL-9 — Hocuspocus collab service container.
# Multi-stage so the runtime image stays slim and free of build tooling.

FROM node:22-alpine AS build
WORKDIR /app

# Install deps first so a code change doesn't bust the dep cache.
COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── runtime image ────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Install only production deps in the runtime stage.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Non-root user — defense-in-depth against container escape.
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 1234

# Liveness via the HTTP health endpoint defined in src/server.ts.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:1234/health || exit 1

CMD ["node", "dist/server.js"]
