import express from 'express';
import { getSystemStats, getSystemInfo, discoverServices } from './stats.js';
import { VALID_CHECK_TYPES, inferCheckType, inferIcon } from './services-config.js';
import http from 'http';
import net from 'net';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Configuration
const CONFIG = {
  settingsPath: process.env.SETTINGS_CONFIG || path.join(__dirname, '..', 'settings.json'),
  corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:5173', 'http://localhost:3001'],
  adminToken: process.env.ADMIN_TOKEN || null, // Set in production!
  maxServices: 50,
  maxNameLength: 100,
  maxPathLength: 200,
};

// Default settings
const DEFAULT_SETTINGS = {
  dashboard: {
    theme: 'default',
    interval: 1,
    sound: true,
    compact: false,
    thresholds: {
      cpu: { warning: 70, critical: 90 },
      memory: { warning: 80, critical: 95 },
      temperature: { warning: 65, critical: 80 }
    }
  },
  api: {
    enabled: false,
    key: null
  },
  services: []
};

// ===================
// Input Validation
// ===================

function sanitizeString(str, maxLength = 100) {
  if (typeof str !== 'string') return '';
  // Remove HTML tags and trim
  return str.replace(/<[^>]*>/g, '').trim().slice(0, maxLength);
}

function validatePort(port) {
  const p = parseInt(port, 10);
  return !isNaN(p) && p >= 1 && p <= 65535 ? p : null;
}

function validateService(service) {
  const errors = [];
  
  if (!service.name || typeof service.name !== 'string') {
    errors.push('Name is required');
  }
  
  const port = validatePort(service.port);
  if (port === null) {
    errors.push('Valid port (1-65535) is required');
  }
  
  if (service.path && typeof service.path !== 'string') {
    errors.push('Path must be a string');
  }
  
  if (service.host && typeof service.host !== 'string') {
    errors.push('Host must be a string');
  }
  
  if (service.checkType && !VALID_CHECK_TYPES.includes(service.checkType)) {
    errors.push(`Invalid checkType. Must be one of: ${VALID_CHECK_TYPES.join(', ')}`);
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  return {
    valid: true,
    sanitized: {
      name: sanitizeString(service.name, CONFIG.maxNameLength),
      port: port,
      path: sanitizeString(service.path || '/', CONFIG.maxPathLength),
      host: sanitizeString(service.host || 'localhost', CONFIG.maxNameLength),
      checkType: inferCheckType(port, service.checkType),
      icon: inferIcon(port, sanitizeString(service.icon || '', 50)),
      enabled: service.enabled !== false,
    }
  };
}

// ===================
// File Operations with Lock
// ===================

// Promise-based mutex to prevent race conditions
let lockPromise = Promise.resolve();

async function withFileLock(fn) {
  let release;
  const acquire = new Promise(resolve => { release = resolve; });
  const previousLock = lockPromise;
  lockPromise = acquire;

  await previousLock;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function loadSettings() {
  try {
    const data = await fs.promises.readFile(CONFIG.settingsPath, 'utf-8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
  } catch (error) {
    console.warn('Could not load settings.json:', error.message);
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(settings) {
  await fs.promises.writeFile(CONFIG.settingsPath, JSON.stringify(settings, null, 2));
}

async function loadServices() {
  const settings = await loadSettings();
  return (settings.services || []).filter(s => s.enabled !== false);
}

async function loadAllServices() {
  const settings = await loadSettings();
  return settings.services || [];
}

async function saveServices(services) {
  const settings = await loadSettings();
  settings.services = services;
  await saveSettings(settings);
}

// ===================
// Auth Middleware
// ===================

function requireAuth(req, res, next) {
  // If no admin token configured, allow all (dev mode)
  if (!CONFIG.adminToken) {
    return next();
  }
  
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== CONFIG.adminToken) {
    return res.status(401).json({ error: 'Unauthorized. Set X-Admin-Token header.' });
  }
  next();
}

// API Key middleware for public API
async function requireApiKey(req, res, next) {
  const settings = await loadSettings();
  const apiConfig = settings.api || DEFAULT_SETTINGS.api;

  // API not enabled
  if (!apiConfig.enabled) {
    return res.status(403).json({ error: 'API access is disabled. Enable it in dashboard settings.' });
  }

  // No key configured = open access
  if (!apiConfig.keyHash) {
    return next();
  }

  // Check API key from header or query param
  const providedKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '') || req.query.key;

  if (!providedKey || hashApiKey(providedKey) !== apiConfig.keyHash) {
    return res.status(401).json({ error: 'Invalid API key. Provide X-API-Key header or ?key= param.' });
  }

  next();
}

// Generate random API key
function generateApiKey() {
  return crypto.randomBytes(24).toString('base64url'); // 32 chars, URL-safe
}

// Hash API key for storage (we don't store the plain key)
function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// ===================
// Service Health Check (supports HTTP, TCP, Redis, DNS)
// ===================

// HTTP health check
function checkHttpService(service) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ ...service, status: 'offline', latency: null });
    }, 3000);

    const start = Date.now();
    const req = http.request({
      hostname: service.host || 'localhost',
      port: service.port,
      path: service.path || '/',
      method: 'HEAD',
      timeout: 3000
    }, (res) => {
      clearTimeout(timeout);
      const latency = Date.now() - start;
      resolve({
        ...service,
        status: res.statusCode < 500 ? 'online' : 'error',
        latency,
        statusCode: res.statusCode
      });
    });

    req.on('error', () => {
      clearTimeout(timeout);
      resolve({ ...service, status: 'offline', latency: null });
    });

    req.on('timeout', () => {
      req.destroy();
      clearTimeout(timeout);
      resolve({ ...service, status: 'offline', latency: null });
    });

    req.end();
  });
}

// TCP health check (just connect)
function checkTcpService(service) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ ...service, status: 'offline', latency: null });
    }, 3000);

    socket.connect(service.port, service.host || 'localhost', () => {
      clearTimeout(timeout);
      const latency = Date.now() - start;
      socket.destroy();
      resolve({ ...service, status: 'online', latency });
    });

    socket.on('error', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve({ ...service, status: 'offline', latency: null });
    });
  });
}

// Redis health check (PING/PONG)
function checkRedisService(service) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ ...service, status: 'offline', latency: null });
    }, 3000);

    socket.connect(service.port, service.host || 'localhost', () => {
      socket.write('PING\r\n');
    });

    socket.on('data', (data) => {
      clearTimeout(timeout);
      const latency = Date.now() - start;
      const response = data.toString().trim();
      socket.destroy();
      resolve({
        ...service,
        status: response.includes('PONG') ? 'online' : 'error',
        latency
      });
    });

    socket.on('error', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve({ ...service, status: 'offline', latency: null });
    });
  });
}

// DNS health check
function checkDnsService(service) {
  return new Promise((resolve) => {
    const start = Date.now();
    const host = service.host || '127.0.0.1';
    const port = service.port || 53;
    
    // DNS resolver needs IP address, convert localhost
    const ip = host === 'localhost' ? '127.0.0.1' : host;
    
    const resolver = new dns.Resolver();
    resolver.setServers([`${ip}:${port}`]);
    
    const timeout = setTimeout(() => {
      resolve({ ...service, status: 'offline', latency: null });
    }, 3000);

    // Try to resolve a simple domain
    resolver.resolve('google.com', (err) => {
      clearTimeout(timeout);
      const latency = Date.now() - start;
      resolve({
        ...service,
        status: err ? 'offline' : 'online',
        latency: err ? null : latency
      });
    });
  });
}

// Interface check (for VPNs like WireGuard)
function checkInterfaceService(service) {
  return new Promise((resolve) => {
    const start = Date.now();
    const iface = service.interface || service.path || 'wg0';
    
    // Check if interface exists via /sys/class/net
    const ifacePath = `/sys/class/net/${iface}`;
    
    fs.access(ifacePath, fs.constants.F_OK, (err) => {
      const latency = Date.now() - start;
      resolve({
        ...service,
        status: err ? 'offline' : 'online',
        latency: err ? null : latency
      });
    });
  });
}

// Main check dispatcher
function checkService(service) {
  switch (service.checkType) {
    case 'tcp':
      return checkTcpService(service);
    case 'redis':
      return checkRedisService(service);
    case 'dns':
      return checkDnsService(service);
    case 'interface':
      return checkInterfaceService(service);
    case 'http':
    default:
      return checkHttpService(service);
  }
}

// ===================
// Middleware
// ===================

app.use(express.json({ limit: '10kb' })); // Limit payload size

// CORS - configurable origins
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || CONFIG.corsOrigins.includes('*') || CONFIG.corsOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Admin-Token, X-API-Key, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Rate limiting (simple in-memory)
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 100; // requests per window

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  for (const [ip, requests] of rateLimit) {
    const validRequests = requests.filter(t => t > windowStart);
    if (validRequests.length === 0) {
      rateLimit.delete(ip);
    } else {
      rateLimit.set(ip, validRequests);
    }
  }
}, 300000);

app.use('/api/services/config', (req, res, next) => {
  if (req.method === 'GET') return next(); // No rate limit on reads
  
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  if (!rateLimit.has(ip)) {
    rateLimit.set(ip, []);
  }
  
  const requests = rateLimit.get(ip).filter(t => t > windowStart);
  requests.push(now);
  rateLimit.set(ip, requests);
  
  if (requests.length > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }
  
  next();
});

// ===================
// API Routes - Public (v1 with API key)
// ===================

// Full system data (stats + sysinfo combined)
app.get('/api/v1/system', requireApiKey, async (req, res) => {
  try {
    const settings = await loadSettings();
    const servicesList = await loadServices();
    
    const [stats, info, wireguard, services] = await Promise.all([
      getSystemStats(),
      getSystemInfo(),
      getWireGuardData(settings),
      Promise.all(servicesList.map(checkService))
    ]);
    
    const response = {
      timestamp: Date.now(),
      system: info.system,
      cpu: {
        ...stats.cpu,
        manufacturer: info.cpu.manufacturer,
        brand: info.cpu.brand,
        cores: info.cpu.cores,
        physicalCores: info.cpu.physicalCores
      },
      memory: {
        ...stats.memory,
        type: info.memory.type,
        formFactor: info.memory.formFactor
      },
      temperature: stats.temperature,
      load: stats.load,
      os: {
        ...stats.os,
        kernel: info.os.kernel,
        codename: info.os.codename,
        fqdn: info.os.fqdn
      },
      disks: stats.disks,
      network: stats.network,
      containers: stats.containers,
      processes: stats.processes,
      baseboard: info.baseboard,
      services
    };
    
    // Include WireGuard data if enabled
    if (wireguard.enabled) {
      response.wireguard = wireguard;
    }
    
    res.json(response);
  } catch (error) {
    console.error('Error fetching system data:', error.message);
    res.status(500).json({ error: 'Failed to fetch system data' });
  }
});

// ===================
// WireGuard API
// ===================

// Parse "X minutes, Y seconds ago" or similar to seconds
function parseHandshakeTime(str) {
  if (!str) return null;
  
  let totalSeconds = 0;
  const parts = str.match(/(\d+)\s*(second|minute|hour|day)s?/gi);
  if (!parts) return null;
  
  for (const part of parts) {
    const match = part.match(/(\d+)\s*(second|minute|hour|day)/i);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();
      if (unit.startsWith('second')) totalSeconds += value;
      else if (unit.startsWith('minute')) totalSeconds += value * 60;
      else if (unit.startsWith('hour')) totalSeconds += value * 3600;
      else if (unit.startsWith('day')) totalSeconds += value * 86400;
    }
  }
  
  return totalSeconds;
}

// Format seconds to human-readable "X min ago" style
function formatTimeAgo(seconds) {
  if (seconds === null || seconds === undefined) return 'never';
  if (seconds < 60) return `${seconds} sec ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} day ago`;
}

// Parse wg show output
function parseWgShow(output, interfaceName) {
  const result = {
    interface: {
      name: interfaceName,
      publicKey: null,
      listenPort: null
    },
    peers: []
  };
  
  const lines = output.split('\n');
  let currentPeer = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Interface info
    if (trimmed.startsWith('public key:')) {
      if (!currentPeer) {
        result.interface.publicKey = trimmed.replace('public key:', '').trim();
      }
    } else if (trimmed.startsWith('listening port:')) {
      result.interface.listenPort = parseInt(trimmed.replace('listening port:', '').trim(), 10);
    }
    // New peer
    else if (trimmed.startsWith('peer:')) {
      if (currentPeer) {
        result.peers.push(currentPeer);
      }
      currentPeer = {
        publicKey: trimmed.replace('peer:', '').trim(),
        endpoint: null,
        lastHandshake: null,
        lastHandshakeSeconds: null,
        transfer: { received: 0, sent: 0 }
      };
    }
    // Peer details
    else if (currentPeer) {
      if (trimmed.startsWith('endpoint:')) {
        currentPeer.endpoint = trimmed.replace('endpoint:', '').trim();
      } else if (trimmed.startsWith('latest handshake:')) {
        const handshakeStr = trimmed.replace('latest handshake:', '').trim();
        currentPeer.lastHandshakeSeconds = parseHandshakeTime(handshakeStr);
        if (currentPeer.lastHandshakeSeconds !== null) {
          currentPeer.lastHandshake = Math.floor(Date.now() / 1000) - currentPeer.lastHandshakeSeconds;
        }
      } else if (trimmed.startsWith('transfer:')) {
        // Parse "3.65 MiB received, 17.21 MiB sent"
        const transferStr = trimmed.replace('transfer:', '').trim();
        const rxMatch = transferStr.match(/([\d.]+)\s*(B|KiB|MiB|GiB)\s*received/i);
        const txMatch = transferStr.match(/([\d.]+)\s*(B|KiB|MiB|GiB)\s*sent/i);
        
        const parseBytes = (value, unit) => {
          const v = parseFloat(value);
          const u = unit.toLowerCase();
          if (u === 'b') return Math.round(v);
          if (u === 'kib') return Math.round(v * 1024);
          if (u === 'mib') return Math.round(v * 1024 * 1024);
          if (u === 'gib') return Math.round(v * 1024 * 1024 * 1024);
          return Math.round(v);
        };
        
        if (rxMatch) currentPeer.transfer.received = parseBytes(rxMatch[1], rxMatch[2]);
        if (txMatch) currentPeer.transfer.sent = parseBytes(txMatch[1], txMatch[2]);
      }
    }
  }
  
  // Push last peer
  if (currentPeer) {
    result.peers.push(currentPeer);
  }
  
  return result;
}

// Parse pivpn -l output to get client names
function parsePivpnList(output) {
  const clients = new Map();
  const lines = output.split('\n');
  
  for (const line of lines) {
    // Format: "phone        Tw5JUD0NvrGO+OxN+rE3HYdOqa/AYB5swNwQtOGjxl0=      07 Jan 2025..."
    // Skip headers and empty lines
    if (line.includes('Client') && line.includes('Public key')) continue;
    if (line.includes(':::')) continue;
    if (!line.trim()) continue;
    
    // Match: name (word chars), then spaces, then base64 public key
    const match = line.match(/^(\S+)\s+([A-Za-z0-9+/=]{44})/);
    if (match) {
      const name = match[1];
      const publicKey = match[2];
      clients.set(publicKey, name);
    }
  }
  
  return clients;
}

// Get WireGuard data (reusable function)
async function getWireGuardData(settings) {
  const wgConfig = settings?.wireguard || { enabled: false, interface: 'wg0' };
  
  if (!wgConfig.enabled) {
    return { enabled: false };
  }
  
  const interfaceName = wgConfig.interface || 'wg0';
  
  // Validate interface name (security: prevent command injection)
  const VALID_IFACE_REGEX = /^[a-zA-Z0-9_-]{1,15}$/;
  if (!VALID_IFACE_REGEX.test(interfaceName)) {
    return { enabled: true, error: 'Invalid WireGuard interface name' };
  }
  
  try {
    // Execute wg show
    let wgResult;
    try {
      wgResult = await execAsync(`wg show ${interfaceName}`, { timeout: 5000 });
    } catch (e) {
      wgResult = await execAsync(`sudo wg show ${interfaceName}`, { timeout: 5000 });
    }
    const wgOutput = wgResult.stdout;
    
    // pivpn -l or clients.txt fallback
    let pivpnOutput = '';
    try {
      const pivpnResult = await execAsync('pivpn -l', { timeout: 5000 });
      pivpnOutput = pivpnResult.stdout;
    } catch (e) {
      try {
        const clientsTxt = await fs.promises.readFile('/etc/wireguard/configs/clients.txt', 'utf-8');
        for (const line of clientsTxt.split('\n')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 2 && parts[1].length === 44) {
            pivpnOutput += `${parts[0]}        ${parts[1]}      date\n`;
          }
        }
      } catch (fallbackErr) {}
    }
    
    // Parse outputs
    const wgData = parseWgShow(wgOutput, interfaceName);
    const clientNames = parsePivpnList(pivpnOutput);
    
    const ONLINE_THRESHOLD_SECONDS = 180;
    
    const clients = wgData.peers.map(peer => {
      const name = clientNames.get(peer.publicKey) || 'unknown';
      const isOnline = peer.lastHandshakeSeconds !== null && 
                       peer.lastHandshakeSeconds < ONLINE_THRESHOLD_SECONDS;
      
      return {
        name,
        publicKey: peer.publicKey,
        online: isOnline,
        endpoint: peer.endpoint || null,
        lastHandshake: peer.lastHandshake,
        lastHandshakeAgo: formatTimeAgo(peer.lastHandshakeSeconds),
        transfer: peer.transfer
      };
    });
    
    clients.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    
    return {
      enabled: true,
      interface: wgData.interface,
      clients
    };
  } catch (error) {
    return { enabled: true, error: `Failed to get WireGuard status: ${error.message}` };
  }
}

// WireGuard internal endpoint
app.get('/api/wireguard', requireAuth, async (req, res) => {
  try {
    const settings = await loadSettings();
    const data = await getWireGuardData(settings);
    
    if (!data.enabled) {
      return res.status(503).json({ 
        enabled: false, 
        error: 'WireGuard monitoring is disabled. Enable it in dashboard settings.' 
      });
    }
    
    if (data.error) {
      return res.status(500).json(data);
    }
    
    res.json(data);
  } catch (error) {
    console.error('WireGuard API error:', error.message);
    res.status(500).json({ enabled: true, error: 'Failed to fetch WireGuard data' });
  }
});

// Get WireGuard settings (for dashboard)
app.get('/api/settings/wireguard', async (req, res) => {
  try {
    const settings = await loadSettings();
    const wgConfig = settings.wireguard || { enabled: false, interface: 'wg0' };
    res.json(wgConfig);
  } catch (error) {
    console.error('Error loading WireGuard settings:', error.message);
    res.status(500).json({ error: 'Failed to load WireGuard settings' });
  }
});

// Update WireGuard settings
app.put('/api/settings/wireguard', requireAuth, async (req, res) => {
  try {
    const { enabled, interface: iface } = req.body;
    
    await withFileLock(async () => {
      const settings = await loadSettings();
      if (!settings.wireguard) {
        settings.wireguard = { enabled: false, interface: 'wg0' };
      }
      
      if (typeof enabled === 'boolean') {
        settings.wireguard.enabled = enabled;
      }
      if (typeof iface === 'string' && iface.match(/^[a-zA-Z0-9_-]+$/)) {
        settings.wireguard.interface = iface;
      }
      
      await saveSettings(settings);
    });
    
    const settings = await loadSettings();
    res.json(settings.wireguard);
  } catch (error) {
    console.error('Error saving WireGuard settings:', error.message);
    res.status(500).json({ error: 'Failed to save WireGuard settings' });
  }
});

// ===================
// API Routes - Internal
// ===================

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await getSystemStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error.message);
    res.status(500).json({ error: 'Failed to fetch system stats' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/api/sysinfo', async (req, res) => {
  try {
    const info = await getSystemInfo();
    res.json(info);
  } catch (error) {
    console.error('Error fetching system info:', error.message);
    res.status(500).json({ error: 'Failed to fetch system info' });
  }
});

app.get('/api/services', async (req, res) => {
  try {
    const services = await loadServices();
    const results = await Promise.all(services.map(checkService));
    res.json(results);
  } catch (error) {
    console.error('Error checking services:', error.message);
    res.status(500).json({ error: 'Failed to check services' });
  }
});

// Get all dashboard settings
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await loadSettings();
    res.json(settings.dashboard);
  } catch (error) {
    console.error('Error loading settings:', error.message);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// Update dashboard settings
app.put('/api/settings', requireAuth, async (req, res) => {
  try {
    const newDashboardSettings = req.body;

    await withFileLock(async () => {
      const settings = await loadSettings();
      settings.dashboard = { ...settings.dashboard, ...newDashboardSettings };
      await saveSettings(settings);
    });

    const settings = await loadSettings();
    res.json(settings.dashboard);
  } catch (error) {
    console.error('Error saving settings:', error.message);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Get API settings
app.get('/api/settings/api', async (req, res) => {
  try {
    const settings = await loadSettings();
    const apiConfig = settings.api || DEFAULT_SETTINGS.api;
    res.json({
      enabled: apiConfig.enabled,
      hasKey: !!apiConfig.keyHash,
      // Key is never exposed - it's hashed and can't be recovered
    });
  } catch (error) {
    console.error('Error loading API settings:', error.message);
    res.status(500).json({ error: 'Failed to load API settings' });
  }
});

// Update API settings
app.put('/api/settings/api', requireAuth, async (req, res) => {
  try {
    const { enabled, generateKey, clearKey } = req.body;
    let newKey = null; // Only set when generating new key

    await withFileLock(async () => {
      const settings = await loadSettings();
      if (!settings.api) settings.api = { ...DEFAULT_SETTINGS.api };

      if (typeof enabled === 'boolean') {
        settings.api.enabled = enabled;
      }

      if (generateKey) {
        newKey = generateApiKey();
        settings.api.keyHash = hashApiKey(newKey);
      }

      if (clearKey) {
        settings.api.keyHash = null;
      }

      // Clean up old 'key' field if present (migration)
      delete settings.api.key;

      await saveSettings(settings);
    });

    const settings = await loadSettings();
    res.json({
      enabled: settings.api.enabled,
      hasKey: !!settings.api.keyHash,
      key: newKey // Only returned once at generation, null otherwise
    });
  } catch (error) {
    console.error('Error saving API settings:', error.message);
    res.status(500).json({ error: 'Failed to save API settings' });
  }
});

// ===================
// API Routes - Protected (Config)
// ===================

// Discover services by scanning listening ports
app.get('/api/services/discover', async (req, res) => {
  try {
    const discovered = await discoverServices();
    const configured = await loadAllServices();
    const configuredPorts = new Set(configured.map(s => s.port));

    // Mark which discovered services are already configured
    const suggestions = discovered.map(service => ({
      ...service,
      alreadyConfigured: configuredPorts.has(service.port)
    }));

    res.json({
      discovered: suggestions,
      configured: configured.length,
      newCount: suggestions.filter(s => !s.alreadyConfigured).length
    });
  } catch (error) {
    console.error('Service discovery error:', error.message);
    res.status(500).json({ error: 'Failed to discover services' });
  }
});

// Get services config (all services, for editing)
app.get('/api/services/config', async (req, res) => {
  try {
    const services = await loadAllServices();
    res.json({ services, requiresAuth: !!CONFIG.adminToken });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load services config' });
  }
});

// Update services config (full replace)
app.put('/api/services/config', requireAuth, async (req, res) => {
  try {
    const { services } = req.body;

    if (!Array.isArray(services)) {
      return res.status(400).json({ error: 'Services must be an array' });
    }

    if (services.length > CONFIG.maxServices) {
      return res.status(400).json({ error: `Maximum ${CONFIG.maxServices} services allowed` });
    }

    // Validate and sanitize all services
    const validatedServices = [];
    for (let i = 0; i < services.length; i++) {
      const result = validateService(services[i]);
      if (!result.valid) {
        return res.status(400).json({ error: `Service ${i + 1}: ${result.errors.join(', ')}` });
      }
      validatedServices.push(result.sanitized);
    }

    await withFileLock(async () => {
      await saveServices(validatedServices);
    });

    res.json({ success: true, services: validatedServices });
  } catch (error) {
    console.error('Error saving services:', error.message);
    res.status(500).json({ error: 'Failed to save services config' });
  }
});

// Add a new service
app.post('/api/services/config', requireAuth, async (req, res) => {
  try {
    const result = validateService(req.body);
    if (!result.valid) {
      return res.status(400).json({ error: result.errors.join(', ') });
    }

    await withFileLock(async () => {
      const services = await loadAllServices();

      if (services.length >= CONFIG.maxServices) {
        throw new Error(`Maximum ${CONFIG.maxServices} services allowed`);
      }

      services.push(result.sanitized);
      await saveServices(services);
    });

    const services = await loadAllServices();
    res.json({ success: true, services });
  } catch (error) {
    console.error('Error adding service:', error.message);
    res.status(500).json({ error: 'Failed to add service' });
  }
});

// Delete a service by index
app.delete('/api/services/config/:index', requireAuth, async (req, res) => {
  try {
    const index = parseInt(req.params.index, 10);

    if (isNaN(index) || index < 0) {
      return res.status(400).json({ error: 'Invalid index' });
    }

    let notFound = false;
    await withFileLock(async () => {
      const services = await loadAllServices();

      if (index >= services.length) {
        notFound = true;
        return;
      }

      services.splice(index, 1);
      await saveServices(services);
    });

    if (notFound) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const services = await loadAllServices();
    res.json({ success: true, services });
  } catch (error) {
    console.error('Error deleting service:', error.message);
    res.status(500).json({ error: 'Failed to delete service' });
  }
});

// ===================
// Static Files & SPA
// ===================

const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});

// ===================
// Start Server
// ===================

app.listen(PORT, () => {
  console.log(`Pi Dashboard API running on http://localhost:${PORT}`);
  console.log(`Settings config: ${CONFIG.settingsPath}`);
  console.log(`Auth required: ${CONFIG.adminToken ? 'Yes' : 'No (dev mode)'}`);
});
