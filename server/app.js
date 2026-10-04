import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { generateApiKey, hashApiKey, requireAdmin, requireApiKey } from './auth.js';
import { checkService } from './checks.js';
import { VERSION } from './config.js';
import { discoverServices } from './discovery.js';
import { RANGES } from './history.js';
import { mountMcp } from './mcp.js';
import { IFACE_NAME } from './services-config.js';
import { DEFAULT_SETTINGS, sanitizeDashboardPatch, validateService } from './settings.js';
import { createSystemInfoReader } from './sysinfo.js';
import { getWireGuardData } from './wireguard.js';

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 100;

function rateLimiter() {
  const hits = new Map();
  setInterval(() => {
    const floor = Date.now() - RATE_WINDOW_MS;
    for (const [ip, times] of hits) {
      const recent = times.filter(t => t > floor);
      if (recent.length) hits.set(ip, recent);
      else hits.delete(ip);
    }
  }, 300_000).unref();
  return (req, res, next) => {
    if (req.method === 'GET') return next();
    const ip = req.ip || req.socket.remoteAddress;
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter(t => t > now - RATE_WINDOW_MS);
    recent.push(now);
    hits.set(ip, recent);
    if (recent.length > RATE_MAX) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    next();
  };
}

/** Wraps an async handler: a rejection becomes a 500 with the route's own message. */
const guard = (message, handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    console.error(`${message}:`, error.message);
    if (!res.headersSent) res.status(500).json({ error: message });
  }
};

export function createApp({ config, store, collector }) {
  const app = express();
  const admin = requireAdmin(config);
  const apiKey = requireApiKey(store);
  const systemInfo = createSystemInfoReader(collector.readOsInfo);
  const checkOptions = { sysRoot: config.host.sys };

  const enabledServices = async () => (await store.load()).services.filter(s => s.enabled !== false);
  const checkAll = services => Promise.all(services.map(s => checkService(s, checkOptions)));

  /** Everything the external API and the MCP tools need, gathered in one place. */
  const context = {
    config,
    store,
    collector,
    systemInfo,
    servicesStatus: async () => checkAll(await enabledServices()),
    wireguard: async () => getWireGuardData(await store.load()),
  };

  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin || '*');
      res.header('Vary', 'Origin');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, X-Admin-Token, X-API-Key, Authorization, Mcp-Session-Id, Mcp-Protocol-Version',
    );
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('Referrer-Policy', 'no-referrer');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  app.use('/api/services/config', rateLimiter());

  // ---------------------------------------------------------------- external API (v1)

  async function fullSystem() {
    const settings = await store.load();
    const [stats, info, wireguard, services] = await Promise.all([
      collector.stats(),
      systemInfo(),
      getWireGuardData(settings),
      context.servicesStatus(),
    ]);
    const response = {
      timestamp: Date.now(),
      version: VERSION,
      system: info.system,
      cpu: {
        ...stats.cpu,
        manufacturer: info.cpu.manufacturer,
        brand: info.cpu.brand,
        cores: info.cpu.cores,
        physicalCores: info.cpu.physicalCores,
      },
      memory: { ...stats.memory, type: info.memory.type, formFactor: info.memory.formFactor },
      temperature: stats.temperature,
      load: stats.load,
      os: { ...stats.os, kernel: info.os.kernel, codename: info.os.codename, fqdn: info.os.fqdn },
      disks: stats.disks,
      network: stats.network,
      containers: stats.containers,
      processes: stats.processes,
      baseboard: info.baseboard,
      services,
    };
    if (wireguard.enabled) response.wireguard = wireguard;
    return response;
  }

  function history(req, res) {
    const range = req.query.range || '1h';
    if (!Object.hasOwn(RANGES, range)) {
      return res.status(400).json({ error: `Invalid range. Use one of: ${Object.keys(RANGES).join(', ')}` });
    }
    res.json(collector.history.get(range));
  }

  app.get('/api/v1/system', apiKey, guard('Failed to fetch system data', async (req, res) => res.json(await fullSystem())));
  app.get('/api/v1/history', apiKey, history);

  mountMcp(app, context);

  // ---------------------------------------------------------------- dashboard API

  app.get('/api/health', (req, res) => res.json({ status: 'ok', version: VERSION, timestamp: Date.now() }));
  app.get('/api/stats', guard('Failed to fetch system stats', async (req, res) => res.json(await collector.stats())));
  app.get('/api/history', history);
  app.get('/api/sysinfo', guard('Failed to fetch system info', async (req, res) => res.json(await systemInfo())));
  app.get('/api/services', guard('Failed to check services', async (req, res) => res.json(await context.servicesStatus())));

  app.get(
    '/api/wireguard',
    admin,
    guard('Failed to fetch WireGuard data', async (req, res) => {
      const data = await context.wireguard();
      if (!data.enabled) {
        return res.status(503).json({ enabled: false, error: 'WireGuard monitoring is disabled. Enable it in dashboard settings.' });
      }
      res.status(data.error ? 500 : 200).json(data);
    }),
  );

  // ---------------------------------------------------------------- settings

  app.get('/api/settings', guard('Failed to load settings', async (req, res) => res.json((await store.load()).dashboard)));

  app.put(
    '/api/settings',
    admin,
    guard('Failed to save settings', async (req, res) => {
      const patch = sanitizeDashboardPatch(req.body);
      const dashboard = await store.update(settings => {
        settings.dashboard = {
          ...settings.dashboard,
          ...patch,
          thresholds: { ...settings.dashboard.thresholds, ...patch.thresholds },
        };
        return settings.dashboard;
      });
      res.json(dashboard);
    }),
  );

  const apiSummary = api => ({ enabled: api.enabled, hasKey: Boolean(api.keyHash), mcp: { path: '/mcp' } });

  app.get('/api/settings/api', guard('Failed to load API settings', async (req, res) => res.json(apiSummary((await store.load()).api))));

  app.put(
    '/api/settings/api',
    admin,
    guard('Failed to save API settings', async (req, res) => {
      const { enabled, generateKey, clearKey } = req.body || {};
      let key = null;
      const api = await store.update(settings => {
        if (typeof enabled === 'boolean') settings.api.enabled = enabled;
        if (generateKey) {
          key = generateApiKey();
          settings.api.keyHash = hashApiKey(key);
        }
        if (clearKey) settings.api.keyHash = null;
        // Very first releases stored the key in clear text.
        delete settings.api.key;
        return settings.api;
      });
      // The key is shown once, at generation; only its hash is stored.
      res.json({ ...apiSummary(api), key });
    }),
  );

  app.get('/api/settings/wireguard', guard('Failed to load WireGuard settings', async (req, res) => res.json((await store.load()).wireguard)));

  app.put(
    '/api/settings/wireguard',
    admin,
    guard('Failed to save WireGuard settings', async (req, res) => {
      const { enabled, interface: iface } = req.body || {};
      const wireguard = await store.update(settings => {
        if (typeof enabled === 'boolean') settings.wireguard.enabled = enabled;
        if (typeof iface === 'string' && IFACE_NAME.test(iface)) settings.wireguard.interface = iface;
        return settings.wireguard;
      });
      res.json(wireguard);
    }),
  );

  // ---------------------------------------------------------------- services config

  app.get(
    '/api/services/discover',
    guard('Failed to discover services', async (req, res) => {
      const [discovered, { services }] = await Promise.all([discoverServices(), store.load()]);
      const configuredPorts = new Set(services.map(s => s.port));
      const suggestions = discovered.map(s => ({ ...s, alreadyConfigured: configuredPorts.has(s.port) }));
      res.json({
        discovered: suggestions,
        configured: services.length,
        newCount: suggestions.filter(s => !s.alreadyConfigured).length,
      });
    }),
  );

  app.get(
    '/api/services/config',
    guard('Failed to load services config', async (req, res) => {
      res.json({ services: (await store.load()).services, requiresAuth: Boolean(config.adminToken) });
    }),
  );

  app.put(
    '/api/services/config',
    admin,
    guard('Failed to save services config', async (req, res) => {
      const { services } = req.body || {};
      if (!Array.isArray(services)) return res.status(400).json({ error: 'Services must be an array' });
      if (services.length > config.limits.maxServices) {
        return res.status(400).json({ error: `Maximum ${config.limits.maxServices} services allowed` });
      }
      const validated = [];
      for (const [i, service] of services.entries()) {
        const result = validateService(service, config.limits);
        if (!result.valid) return res.status(400).json({ error: `Service ${i + 1}: ${result.errors.join(', ')}` });
        validated.push(result.sanitized);
      }
      await store.update(settings => {
        settings.services = validated;
      });
      res.json({ success: true, services: validated });
    }),
  );

  app.post(
    '/api/services/config',
    admin,
    guard('Failed to add service', async (req, res) => {
      const result = validateService(req.body, config.limits);
      if (!result.valid) return res.status(400).json({ error: result.errors.join(', ') });
      const services = await store.update(settings => {
        if (settings.services.length >= config.limits.maxServices) return null;
        settings.services.push(result.sanitized);
        return settings.services;
      });
      if (!services) return res.status(400).json({ error: `Maximum ${config.limits.maxServices} services allowed` });
      res.json({ success: true, services });
    }),
  );

  app.delete(
    '/api/services/config/:index',
    admin,
    guard('Failed to delete service', async (req, res) => {
      const index = Number.parseInt(req.params.index, 10);
      if (Number.isNaN(index) || index < 0) return res.status(400).json({ error: 'Invalid index' });
      const services = await store.update(settings => {
        if (index >= settings.services.length) return null;
        settings.services.splice(index, 1);
        return settings.services;
      });
      if (!services) return res.status(404).json({ error: 'Service not found' });
      res.json({ success: true, services });
    }),
  );

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // ---------------------------------------------------------------- static frontend

  if (fs.existsSync(config.distPath)) {
    app.use(
      express.static(config.distPath, {
        index: 'index.html',
        setHeaders(res, file) {
          // Hashed assets never change; the HTML that points at them must always be fresh.
          res.setHeader('Cache-Control', file.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.use((req, res, next) => {
      // SPA fallback for navigations only: a missing asset must stay a 404.
      if (req.method !== 'GET' || path.extname(req.path)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.distPath, 'index.html'));
    });
  }

  return app;
}

export { DEFAULT_SETTINGS };
