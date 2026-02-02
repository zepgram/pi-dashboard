# Pi Dashboard 🖥️

A beautiful, real-time monitoring dashboard for Raspberry Pi home servers.

<img width="100%" height="auto" alt="Capture d’écran 2026-01-25 à 23 39 53" src="https://github.com/user-attachments/assets/e2e60248-bbde-43f4-b090-5a6bc7b981c3" />

![Modern 2026 Design](https://img.shields.io/badge/design-modern%202026-blueviolet)
![Raspberry Pi](https://img.shields.io/badge/platform-Raspberry%20Pi-c51a4a)
![License](https://img.shields.io/badge/license-MIT-green)
[![Docker Hub](https://img.shields.io/docker/v/usernamedigital/pi-dashboard?label=Docker%20Hub&logo=docker)](https://hub.docker.com/r/usernamedigital/pi-dashboard)
[![Docker Pulls](https://img.shields.io/docker/pulls/usernamedigital/pi-dashboard)](https://hub.docker.com/r/usernamedigital/pi-dashboard)

## ✨ Features

- **Real-time monitoring** — CPU, RAM, temperature, disk usage
- **Temperature insights** — Min/max session tracking, throttling status (via vcgencmd)
- **Docker integration** — Container stats with CPU/memory usage
- **WireGuard VPN** — Monitor connected clients, transfer stats, last seen
- **Network stats** — Bandwidth, connections per interface
- **Service health** — HTTP, TCP, Redis, DNS health checks
- **External API** — REST API with key authentication for external apps
- **Modern UI** — Glassmorphism, smooth animations, dark theme
- **Display modes** — Normal, Compact, and Ultra-compact layouts
- **Multiple themes** — 5 color themes (cyan, emerald, rose, amber, indigo)
- **Persistent settings** — Server-side config, shared across devices
- **PWA ready** — Install on mobile, works offline

## 🎨 Design

Silicon/AI aesthetic inspired by Apple System Preferences meets Vercel Dashboard:
- Deep dark theme (#0a0a0a)
- Glassmorphism cards
- Cyan/purple accent gradients
- Smooth micro-interactions
- Responsive card-based layout
- Multiple color themes

## 🚀 Quick Start

```bash
# Clone
git clone https://github.com/zepgram/pi-dashboard.git
cd pi-dashboard

# Install
npm install

# Run (dev)
npm run dev
```

Dashboard available at `http://localhost:5173`

## 🐳 Docker

### Quick Start (Docker Hub)

The easiest way — use the pre-built multi-arch image (supports amd64 and arm64):

```bash
# Create a directory for your config
mkdir -p pi-dashboard/data && cd pi-dashboard

# Download docker-compose.yml
curl -O https://raw.githubusercontent.com/zepgram/pi-dashboard/main/docker-compose.yml

# Start
docker compose up -d
```

Dashboard available at `http://your-pi-ip:3001`

### Quick Start (Build from source)

```bash
# Clone
git clone https://github.com/zepgram/pi-dashboard.git
cd pi-dashboard

# Create data directory
mkdir -p data

# Build and start
docker compose up -d --build
```

### docker-compose.yml

```yaml
services:
  pi-dashboard:
    image: usernamedigital/pi-dashboard:latest
    # Or build locally:
    # build: .
    container_name: pi-dashboard
    restart: unless-stopped

    environment:
      - PORT=3001
      - ADMIN_TOKEN=           # Optional: protect config endpoints
      - CORS_ORIGINS=*         # Or specific origins

    volumes:
      # Persistent settings (dashboard config, services, API keys)
      - ./data:/app/data

      # System monitoring (required)
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/host/root:ro

      # Docker container monitoring
      - /var/run/docker.sock:/var/run/docker.sock:ro

      # WireGuard monitoring (optional)
      - /etc/wireguard:/etc/wireguard:ro

    # Required for full system access
    pid: host
    network_mode: host

    # Required for WireGuard monitoring
    cap_add:
      - NET_ADMIN

    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

### Available Tags

| Tag | Description |
|-----|-------------|
| `latest` | Latest stable release from main branch |
| `1.0.0` | Specific version (semver) |
| `1.0` | Latest patch for minor version |
| `1` | Latest minor for major version |
| `<sha>` | Specific commit (7 chars) |

### Key Points

| Setting | Purpose |
|---------|---------|
| `pid: host` | Access host processes (top processes, accurate CPU stats) |
| `network_mode: host` | Access host network interfaces, no port mapping needed |
| `/proc:/host/proc:ro` | Read host CPU, memory, process info |
| `/sys:/host/sys:ro` | Read host temperature, disk info, cgroups |
| `/:/host/root:ro` | Read host disk usage, OS info |
| `/var/run/docker.sock` | Monitor Docker containers |
| `/etc/wireguard:ro` | Read WireGuard client configs (optional) |
| `cap_add: NET_ADMIN` | Required for `wg show` command |
| `./data:/app/data` | Persist settings & API keys across restarts |

### Manual Docker Run

```bash
# Using Docker Hub image
docker run -d --name pi-dashboard \
  --pid=host \
  --network=host \
  --cap-add=NET_ADMIN \
  -v $(pwd)/data:/app/data \
  -v /proc:/host/proc:ro \
  -v /sys:/host/sys:ro \
  -v /:/host/root:ro \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /etc/wireguard:/etc/wireguard:ro \
  usernamedigital/pi-dashboard:latest

# Or build locally
docker build -t pi-dashboard .
docker run -d --name pi-dashboard \
  --pid=host \
  --network=host \
  --cap-add=NET_ADMIN \
  -v $(pwd)/data:/app/data \
  -v /proc:/host/proc:ro \
  -v /sys:/host/sys:ro \
  -v /:/host/root:ro \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /etc/wireguard:/etc/wireguard:ro \
  pi-dashboard
```

## 📁 Structure

```
├── server/
│   ├── index.js      # Express API
│   └── stats.js      # System stats collector
├── src/
│   ├── index.html
│   ├── main.js
│   └── style.css
├── data/
│   └── settings.json # Persistent config (mount as volume)
├── Dockerfile
├── package.json
└── vite.config.js
```

## ⚙️ Configuration

All settings are stored in `settings.json` — both dashboard preferences and services:

```json
{
  "dashboard": {
    "theme": "default",
    "interval": 2,
    "sound": true,
    "compact": false,
    "thresholds": {
      "cpu": { "warning": 70, "critical": 90 },
      "memory": { "warning": 80, "critical": 95 },
      "temperature": { "warning": 65, "critical": 80 }
    }
  },
  "api": {
    "enabled": false,
    "keyHash": null
  },
  "services": [
    {
      "name": "Pi-hole Admin",
      "port": 80,
      "path": "/admin/",
      "host": "localhost",
      "checkType": "http",
      "icon": "shield",
      "enabled": true
    },
    {
      "name": "Nextcloud",
      "port": 8080,
      "path": "/",
      "checkType": "http",
      "icon": "cloud",
      "enabled": true
    }
  ]
}
```

### Dashboard Settings

| Field | Description | Default |
|-------|-------------|---------|
| `theme` | Color theme (default, emerald, rose, amber, indigo) | `default` |
| `interval` | Refresh interval in seconds | `2` |
| `sound` | Enable alert sounds | `true` |
| `compact` | Compact display mode | `false` |
| `thresholds` | Warning/critical thresholds | see above |

### Service Fields

| Field | Description | Default |
|-------|-------------|---------|
| `name` | Display name | required |
| `port` | Service port | required |
| `path` | Health check path | `/` |
| `host` | Hostname | `localhost` |
| `enabled` | Show in dashboard | `true` |

## 🔧 API Endpoints

### Internal API (dashboard)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stats` | GET | CPU, RAM, temp, containers, disks |
| `/api/settings` | GET | Dashboard settings |
| `/api/settings` | PUT | Update dashboard settings |
| `/api/settings/api` | GET | API access settings |
| `/api/settings/api` | PUT | Enable/disable API, generate key |
| `/api/services` | GET | Service health status |
| `/api/services/config` | GET | Get all services config |
| `/api/services/config` | PUT | Update all services |
| `/api/services/config` | POST | Add a service |
| `/api/services/config/:index` | DELETE | Remove a service |
| `/api/services/discover` | GET | Auto-discover services on listening ports |
| `/api/sysinfo` | GET | System information |
| `/api/health` | GET | Dashboard health check |
| `/api/wireguard` | GET | WireGuard clients status |
| `/api/settings/wireguard` | GET | WireGuard settings (enabled, interface) |
| `/api/settings/wireguard` | PUT | Update WireGuard settings |

### External API (v1)

Public API for external applications, protected by API key.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/system` | GET | Complete system data (stats + sysinfo + wireguard if enabled) |

**Authentication:** Enable API access and generate a key via the dashboard UI (API button in header).

```bash
# Using header
curl -H "X-API-Key: YOUR_KEY" http://your-pi:3001/api/v1/system

# Using query param
curl "http://your-pi:3001/api/v1/system?key=YOUR_KEY"
```

**Response includes:**
- `system` — manufacturer, model, serial
- `cpu` — usage, cores, speed, brand
- `memory` — total, used, free, percent, type (e.g., LPDDR4X)
- `temperature` — main, max, throttled (bitmask from vcgencmd)
- `load` — uptime, loadAvg [1m, 5m, 15m]
- `os` — distro, version, kernel, hostname, arch
- `disks` — mount points with size/used/available
- `network` — interfaces (IP, type) + stats (rx/tx bytes/sec)
- `containers` — Docker containers with CPU/memory stats
- `processes` — Top 10 processes by CPU usage
- `baseboard` — hardware info
- `services` — configured services with health status (online/offline, latency)
- `wireguard` — (if enabled) interface name + clients array with name, publicKey, endpoint, lastHandshake, transfer, online status

**Security:** API keys are hashed (SHA256) before storage. The plain key is shown only once at generation — copy it immediately or regenerate.

## 🔐 Security

Configure via `docker-compose.yml` or environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `ADMIN_TOKEN` | Auth token for config endpoints | _(empty = no auth)_ |
| `CORS_ORIGINS` | Allowed origins (comma-separated) | `*` |
| `PORT` | Server port | `3001` |

When `ADMIN_TOKEN` is set, config write operations require the header:
```
X-Admin-Token: your-secret-token-here
```

**Security features:**
- Input validation & sanitization
- XSS protection
- Rate limiting (100 req/min on config endpoints)
- CORS origin restrictions
- Payload size limits

## 📋 Requirements

- Node.js 22+
- Raspberry Pi (ARM64) or any Linux server
- Docker (optional, for container monitoring)

### 💡 Raspberry Pi: Container Stats

Pi Dashboard reads container CPU from cgroups v2 (`/sys/fs/cgroup/.../cpu.stat`) and memory from `/proc/[PID]/status`. Works **without** enabling the memory cgroup controller — no kernel modifications needed!

CPU usage is normalized to 100% (total CPU capacity), not per-core.

## 🎯 Roadmap

- [x] Persistent server-side settings
- [x] Container CPU/memory stats
- [x] Smooth animations
- [x] Auto-discover services
- [x] External REST API with key auth
- [x] Multiple color themes
- [x] Mobile-friendly UI
- [x] WireGuard VPN monitoring
- [x] Temperature min/max + throttling status
- [x] Display modes (normal/compact/ultra)
- [ ] Historical charts (last hour/day)
- [ ] Log viewer
- [ ] Multi-server support

## 📄 License

MIT — do whatever you want with it.

---

Built with ☕ on a Raspberry Pi 5
