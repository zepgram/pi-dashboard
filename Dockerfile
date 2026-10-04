# Pi Dashboard: multi-arch image (linux/arm64, linux/amd64)

# Everything here is plain JavaScript, so it is built once on the build machine
# and copied into each target image instead of being rebuilt under emulation.
FROM --platform=$BUILDPLATFORM node:24-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src/ ./src/
COPY vite.config.js ./
RUN npm run build
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-alpine

WORKDIR /app

# ss for service discovery, wg for WireGuard peers. vcgencmd (throttling details) only
# exists for ARM and only works when /dev/vcio is passed to the container.
RUN apk add --no-cache iproute2-ss wireguard-tools-wg \
 && (apk add --no-cache raspberrypi-utils-vcgencmd || true)

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY server/ ./server/
COPY settings.json ./settings.json

ENV NODE_ENV=production \
    PORT=3001 \
    CORS_ORIGINS=* \
    SETTINGS_CONFIG=/app/settings.json

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "server/index.js"]
