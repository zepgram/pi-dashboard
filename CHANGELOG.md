# Changelog

## 2.0.0

A rewrite of both halves. Same container setup, same `settings.json`, same API routes:
pulling the new image over a 1.0 install needs no change.

### Added

- **History**: CPU, memory, temperature, load and network are kept for the last hour (5 s
  steps) and the last 24 hours (1 min steps). `GET /api/history?range=1h|24h`, and
  `GET /api/v1/history` behind the API key. History is written to `history.json` next to
  the settings file on shutdown, so a restart or an upgrade does not empty the charts.
- **MCP server** on `/mcp` (Streamable HTTP): seven read-only tools so an AI assistant can
  read the state of the Pi. Uses the same switch and key as the external API.
- **New interface**: time-series charts with 1 h / 24 h ranges, a status strip that says
  what is wrong, a sortable container table, segmented disk gauges. No external request
  any more: fonts and scripts are bundled.
- Container **health** (`healthy` / `unhealthy` / `starting`) in `/api/stats`.
- `https` service check type; an `http` check on port 443 or 8443 now speaks TLS.
- Service discovery also finds services bound to one address (e.g. a reverse proxy on the
  LAN address only) and checks them there.
- `version` and `timestamp` in `/api/stats`, `version` in `/api/health`.
- Tests (`npm test`) and CI.

### Fixed

- **Disks**: inside Docker only `/` was reported, plus one hard-coded path. Every mounted
  block device is now listed.
- **Load**: every request re-measured the whole host with blocking shell commands. One
  sampling loop now serves every client, and slows down when nobody is watching.
- **Network rates** were wrong as soon as two clients polled at the same time.
- **Container memory** counted the main process only; it now covers every process of the
  container. CPU usage also works with the `cgroupfs` driver and cgroup v1.
- **Top processes** showed the average since each process started; they now show the
  current CPU share, like `top`.
- **Throttling** was never detected inside Docker. Live under-voltage is now reported
  without any extra setup, and the full status when `/dev/vcio` is passed to the container.
- **Pending updates** were always 0 inside Docker.
- The interface check always succeeded for services saved from the editor.
- `memory.used` was the kernel's "active" memory; it is now total minus available, the
  figure `free` and the gauge use.
- Settings writes are atomic and validated; a settings file edited by hand is picked up
  without a restart.
- Unknown `/api/...` routes answer `404` JSON instead of the HTML page; missing assets are
  no longer answered with `index.html`.

### Changed

- Node.js 24 in the image (Node.js 22 or newer when running from source).
- The image no longer ships `ps`, `nsenter` and the full `wireguard-tools`.
- `memory.usedPercent` now equals `memory.percent`.

## 1.0.0

Initial release.
