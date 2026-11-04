# Build context: the CRM folder (repository workspace root)
#   docker build -f web/Dockerfile -t crm-web .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --workspace web --include-workspace-root=false
COPY web web
RUN npm run build --workspace web

# Caddy serves the built web app and forwards /api to the API container.
FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/web/dist /srv
