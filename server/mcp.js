import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { checkApiAccess } from './auth.js';
import { VERSION } from './config.js';
import { METRICS, RANGES } from './history.js';

const UNITS = { cpu: '%', memory: '%', temperature: '°C', load: 'load average (1 min)', rx: 'bytes/s', tx: 'bytes/s' };

const json = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const readOnly = { readOnlyHint: true, openWorldHint: false };

/** Thresholds currently exceeded, same rules as the dashboard alerts. */
export function activeAlerts(stats, thresholds) {
  const alerts = [];
  const check = (metric, label, value, unit) => {
    const limits = thresholds?.[metric];
    if (!limits || typeof value !== 'number') return;
    const level = value >= limits.critical ? 'critical' : value >= limits.warning ? 'warning' : null;
    if (level) alerts.push({ level, metric: label, value, unit, threshold: limits[level] });
  };
  check('cpu', 'cpu', stats.cpu.usage, '%');
  check('memory', 'memory', stats.memory.percent, '%');
  check('temperature', 'temperature', stats.temperature.main, '°C');
  for (const disk of stats.disks) check('disk', `disk ${disk.mount}`, disk.percent, '%');
  if (stats.temperature.throttled) {
    alerts.push({ level: 'critical', metric: 'throttling', reasons: stats.temperature.reasons });
  }
  for (const c of stats.containers) {
    if (c.health === 'unhealthy') alerts.push({ level: 'critical', metric: `container ${c.name}`, value: 'unhealthy' });
  }
  return alerts;
}

/** Min / avg / max / last plus at most `maxPoints` averaged points of one history series. */
export function summarizeSeries(history, metric, maxPoints) {
  const values = history.series[metric];
  const present = values.filter(v => v !== null);
  if (present.length === 0) return { metric, unit: UNITS[metric], range: history.range, points: [] };
  const chunk = Math.max(1, Math.ceil(values.length / maxPoints));
  const points = [];
  for (let i = 0; i < values.length; i += chunk) {
    const slice = values.slice(i, i + chunk).filter(v => v !== null);
    if (slice.length === 0) continue;
    points.push({
      time: new Date(history.from + i * history.step * 1000).toISOString(),
      value: Math.round((slice.reduce((a, b) => a + b, 0) / slice.length) * 100) / 100,
    });
  }
  const round = n => Math.round(n * 100) / 100;
  return {
    metric,
    unit: UNITS[metric],
    range: history.range,
    resolutionSeconds: history.step * chunk,
    min: round(Math.min(...present)),
    avg: round(present.reduce((a, b) => a + b, 0) / present.length),
    max: round(Math.max(...present)),
    last: present.at(-1),
    points,
  };
}

function buildServer(context) {
  const { collector, store, systemInfo, servicesStatus, wireguard } = context;
  const server = new McpServer({ name: 'pi-dashboard', version: VERSION });

  server.registerTool(
    'get_system_overview',
    {
      title: 'System overview',
      description:
        'Current state of the host: CPU, memory, temperature and throttling, load, uptime, disks, network rates, ' +
        'container and service counts, and the alerts currently raised against the dashboard thresholds. Start here.',
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      const [stats, settings, services] = await Promise.all([collector.stats(), store.load(), servicesStatus()]);
      const running = stats.containers.filter(c => c.state === 'running').length;
      return json({
        host: stats.os.hostname,
        os: `${stats.os.distro} ${stats.os.version}`.trim(),
        arch: stats.os.arch,
        updatesAvailable: stats.os.updatesAvailable,
        uptimeSeconds: Math.round(stats.load.uptime),
        cpu: { usagePercent: stats.cpu.usage, perCorePercent: stats.cpu.cores, frequencyGHz: stats.cpu.speed, overclocked: stats.cpu.overclocked },
        memory: { usedPercent: stats.memory.percent, usedBytes: stats.memory.used, totalBytes: stats.memory.total, cacheBytes: stats.memory.buffcache },
        temperature: { celsius: stats.temperature.main, throttled: stats.temperature.throttled, throttleReasons: stats.temperature.reasons },
        loadAverage: stats.load.loadAvg,
        disks: stats.disks.map(d => ({ mount: d.mount, device: d.fs, usedPercent: d.percent, usedBytes: d.used, sizeBytes: d.size })),
        network: stats.network.stats.map(n => ({ interface: n.iface, rxBytesPerSec: n.rxSec, txBytesPerSec: n.txSec })),
        containers: { running, total: stats.containers.length, unhealthy: stats.containers.filter(c => c.health === 'unhealthy').map(c => c.name) },
        services: { online: services.filter(s => s.status === 'online').length, total: services.length, down: services.filter(s => s.status !== 'online').map(s => s.name) },
        alerts: activeAlerts(stats, settings.dashboard.thresholds),
        dashboardVersion: VERSION,
      });
    },
  );

  server.registerTool(
    'list_containers',
    {
      title: 'Docker containers',
      description: 'Docker containers with state, health, image, CPU share (100 % = all cores) and memory. Sorted by CPU by default.',
      inputSchema: {
        state: z.enum(['running', 'exited', 'all']).default('all').describe('Filter by container state'),
        sort: z.enum(['cpu', 'memory', 'name']).default('cpu'),
      },
      annotations: readOnly,
    },
    async ({ state, sort }) => {
      const { containers } = await collector.stats();
      const order = { cpu: (a, b) => b.cpuPercent - a.cpuPercent, memory: (a, b) => b.memUsage - a.memUsage, name: (a, b) => a.name.localeCompare(b.name) };
      return json(
        containers
          .filter(c => state === 'all' || c.state === state)
          .sort(order[sort])
          .map(c => ({ name: c.name, image: c.image, state: c.state, status: c.status, health: c.health, cpuPercent: c.cpuPercent, memoryBytes: c.memUsage, memoryPercent: c.memPercent, startedAt: c.started ? new Date(c.started * 1000).toISOString() : null })),
      );
    },
  );

  server.registerTool(
    'get_services_status',
    {
      title: 'Service health checks',
      description: 'Runs the configured health checks (HTTP, HTTPS, TCP, Redis, DNS, network interface) and returns status and latency for each service.',
      inputSchema: {},
      annotations: readOnly,
    },
    async () => json((await servicesStatus()).map(s => ({ name: s.name, host: s.host || 'localhost', port: s.port, check: s.checkType, status: s.status, latencyMs: s.latency, statusCode: s.statusCode }))),
  );

  server.registerTool(
    'get_top_processes',
    {
      title: 'Top processes',
      description: 'Processes using the most CPU right now (100 % = one core), with memory share and command line.',
      inputSchema: { limit: z.number().int().min(1).max(10).default(10) },
      annotations: readOnly,
    },
    async ({ limit }) => json((await collector.stats()).processes.slice(0, limit)),
  );

  server.registerTool(
    'get_history',
    {
      title: 'Metric history',
      description:
        'History of one metric over the last hour or the last 24 hours: min, average, max, last value and a downsampled series. ' +
        'Use it to tell a spike from a trend. History restarts when the dashboard restarts.',
      inputSchema: {
        metric: z.enum(METRICS).describe('cpu and memory in %, temperature in °C, load = 1-min load average, rx/tx = network bytes per second'),
        range: z.enum(Object.keys(RANGES)).default('1h'),
        max_points: z.number().int().min(1).max(240).default(60),
      },
      annotations: readOnly,
    },
    async ({ metric, range, max_points }) => json(summarizeSeries(collector.history.get(range), metric, max_points)),
  );

  server.registerTool(
    'get_wireguard_clients',
    {
      title: 'WireGuard clients',
      description: 'WireGuard VPN peers with online state, endpoint, last handshake and transfer totals. Requires WireGuard monitoring to be enabled in the dashboard settings.',
      inputSchema: {},
      annotations: readOnly,
    },
    async () => json(await wireguard()),
  );

  server.registerTool(
    'get_system_info',
    {
      title: 'Hardware and OS identity',
      description: 'Static facts: board model, CPU, memory type and size, OS release, kernel, architecture.',
      inputSchema: {},
      annotations: readOnly,
    },
    async () => json(await systemInfo()),
  );

  return server;
}

const rpcError = (res, status, message) =>
  res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });

/**
 * Model Context Protocol endpoint (Streamable HTTP, stateless). Read-only tools over the
 * same data as the dashboard, behind the same switch and key as the external API.
 */
export function mountMcp(app, context) {
  app.post('/mcp', async (req, res) => {
    const denied = await checkApiAccess(context.store, req);
    if (denied) return rpcError(res, denied.status, denied.error);
    const server = buildServer(context);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP request failed:', error.message);
      if (!res.headersSent) rpcError(res, 500, 'Internal error');
    }
  });

  const noSession = (req, res) => rpcError(res.set('Allow', 'POST'), 405, 'Method not allowed: this server is stateless, use POST');
  app.get('/mcp', noSession);
  app.delete('/mcp', noSession);
}
