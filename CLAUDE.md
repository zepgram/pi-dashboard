# CLAUDE.md

Guidelines for AI agents working on this project.

## Documentation

`README.md` is the reference for features, API endpoints, configuration and Docker setup.
Keep it and `CHANGELOG.md` up to date when an endpoint, a setting, an MCP tool or the
container setup changes.

## Compatibility contract

The image is pulled by people who follow `latest`. A release must keep working with:

- the published `docker-compose.yml` (volumes, `pid: host`, `network_mode: host`);
- an existing `settings.json` (unknown keys are preserved, never dropped);
- every documented route and response field. Add fields; do not rename or remove them.

## Project structure

```
server/index.js          entry point: config, collector, HTTP server, shutdown
server/app.js            Express app and every route (createApp, used by the tests)
server/collector/        the sampling loop and what it reads
  index.js               Collector: one loop for all clients, feeds the history
  host.js                CPU, memory, temperature, throttling, network, OS
  disks.js               mounted block devices
  docker.js              containers through the Docker socket and cgroups
  processes.js           top processes from /proc deltas
server/history.js        1 h / 24 h ring buffers
server/mcp.js            MCP tools (read-only)
server/checks.js         service health checks
server/settings.js       settings store (atomic, serialized writes) and validation
server/auth.js           admin token and API key
src/index.html           markup, SVG sprite, dialogs
src/js/                  vanilla ES modules: api, state, poller, charts, cards/, modals/
src/css/                 tokens, base, layout, components, modals, modes
test/                    node:test suites (npm test)
```

## Backend rules

- Nothing measures the host inside a request handler: handlers read `collector.stats()`.
- No blocking calls (`execSync`, `readFileSync` of anything slow). Shell out with `run()`
  from `server/util.js`, which never throws.
- Host files are read through `config.host.proc`, `config.host.sys` and `config.host.root`
  so the same code works in the container and on the host.
- A new parser gets a test in `test/parsers.test.js` with a real sample of its input.

## Frontend rules

- No framework, no CDN, no `innerHTML` with API data (`textContent` only).
- Lists are reconciled by key, not rebuilt on every tick.
- Colours, spacing and radii come from the CSS variables in `src/css/tokens.css`; the five
  themes only override variables.
- Three display modes through body classes: none (normal), `compact`, `ultra`. A new
  component must be checked in all three and at 360 px width.
- URL parameters for kiosks and screenshots are documented at the top of `src/js/params.js`.

## Commands

```bash
npm run dev      # API with --watch on :3001, Vite on :5173
npm test
npm run build
docker compose up -d --build
```

## Conventions

- Commit messages: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
- API: dashboard endpoints under `/api/`, key-protected endpoints under `/api/v1/`
