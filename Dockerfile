# Pi Dashboard - ARM64 compatible (multi-stage build)
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY server/ ./server/
COPY src/ ./src/
COPY vite.config.js ./

RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Install dependencies for systeminformation, network stats, and WireGuard
RUN apk add --no-cache procps util-linux iproute2 wireguard-tools

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server

# Copy default settings config
COPY settings.json ./settings.json

# ===================
# Environment Variables (easily configurable)
# ===================

# Server port
ENV PORT=3001

# Admin token for protected endpoints (set in production!)
ENV ADMIN_TOKEN=

# CORS allowed origins (comma-separated, use * for all)
ENV CORS_ORIGINS=*

# Path to settings config file
ENV SETTINGS_CONFIG=/app/settings.json

EXPOSE 3001

CMD ["node", "server/index.js"]
