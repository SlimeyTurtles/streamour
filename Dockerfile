# openssl is needed by Prisma's engines on Alpine; libc6-compat by node-gyp.
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# Stage 1: Dependencies
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# Stage 2: Prisma CLI on its own, for `migrate deploy` at container start.
# The standalone Next output only carries the runtime client, not the CLI.
# The version is read from the lockfile so it always matches @prisma/client.
FROM base AS prisma-cli
WORKDIR /prisma-cli
COPY package-lock.json /tmp/package-lock.json
RUN npm install --no-save --no-audit --no-fund \
    "prisma@$(node -p "require('/tmp/package-lock.json').packages['node_modules/prisma'].version")"

# Stage 3: Builder
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build the Next.js application (the build script runs `prisma generate` first)
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Stage 4: Runner
FROM base AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install ffmpeg for video transcoding
RUN apk add --no-cache ffmpeg

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy tools directory for utility scripts (optional)
COPY --from=builder --chown=nextjs:nodejs /app/tools ./tools

# Writable home for generated HLS and thumbnails. Owned by nextjs here so a
# named volume mounted at /cache starts out writable; a bind-mounted host
# directory must be writable by uid 1001 itself.
RUN mkdir -p /cache && chown nextjs:nodejs /cache
ENV CACHE_DIR=/cache

# Schema + migrations, the CLI that applies them, and the entrypoint that runs it
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=prisma-cli --chown=nextjs:nodejs /prisma-cli /prisma-cli
COPY --from=builder --chown=nextjs:nodejs /app/docker-entrypoint.sh ./docker-entrypoint.sh

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
