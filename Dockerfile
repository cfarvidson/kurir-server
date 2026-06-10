FROM node:20-alpine AS base
RUN corepack enable pnpm && corepack prepare pnpm@9.15.0 --activate

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
# Persist the pnpm content-addressable store across builds so only changed
# packages are refetched when the lockfile drifts.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --store-dir=/pnpm/store \
  || pnpm install --store-dir=/pnpm/store

# Development
FROM base AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm db:generate
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["pnpm", "dev"]

# Build for production
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm db:generate
# The VAPID public key is served to the client at runtime (see
# src/app/api/push/vapid-public-key/route.ts), so no NEXT_PUBLIC_* build arg is
# needed here — both VAPID keys are read from the runtime environment.
# Reuse Next.js's incremental compilation cache across builds. `COPY . .` busts
# the layer cache on any source change, so without this every deploy is a cold
# compile; the mount lets Next skip recompiling unchanged modules.
RUN --mount=type=cache,id=next-cache,target=/app/.next/cache \
  pnpm build

# Production
FROM base AS runner
LABEL org.opencontainers.image.source="https://github.com/cfarvidson/kurir-server"
LABEL org.opencontainers.image.description="Kurir — Hey.com-inspired email client"
LABEL org.opencontainers.image.licenses="LicenseRef-OSaasy"
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# tsx for running CLI scripts, prisma for runtime migrations
RUN npm install -g tsx prisma@7
# Make `import "prisma/config"` resolvable from /app/prisma.config.ts
RUN mkdir -p /app/node_modules \
  && ln -s /usr/local/lib/node_modules/prisma /app/node_modules/prisma

# Backup/restore tools (pg_dump, psql, redis-cli)
RUN apk add --no-cache postgresql16-client redis

# Backup output directory
RUN mkdir -p /app/backups && chown nextjs:nodejs /app/backups

# Static assets
COPY --from=builder /app/public ./public

# Standalone output (includes server.js + bundled node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma schema + config + client runtime (CLI comes from global install above)
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# CLI scripts + source files they import
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
RUN chmod +x scripts/docker-entrypoint.sh scripts/kurir-backup.sh scripts/kurir-restore.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "server.js"]
