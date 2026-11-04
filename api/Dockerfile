# Build context: the CRM folder (repository workspace root)
#   docker build -f api/Dockerfile -t crm-api .
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# prisma.config.ts reads DATABASE_URL; generate does not connect, so a placeholder is enough while building.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build

FROM base AS build
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
COPY api/prisma api/prisma
COPY api/prisma.config.ts api/
RUN npm ci --workspace api --include-workspace-root=false
COPY api api
RUN npm run build --workspace api

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
COPY api/prisma api/prisma
COPY api/prisma.config.ts api/
RUN npm ci --workspace api --include-workspace-root=false --omit=dev && npm cache clean --force
COPY --from=build /app/api/dist api/dist
COPY api/scripts api/scripts
COPY api/src api/src
RUN chown -R node:node /app/api
USER node
WORKDIR /app/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://localhost:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply pending migrations, then start. The real DATABASE_URL comes from docker compose.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
