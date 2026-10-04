import fs from 'node:fs';
import path from 'node:path';
import { IFACE_NAME, VALID_CHECK_TYPES, inferCheckType, inferIcon } from './services-config.js';

export const DEFAULT_SETTINGS = Object.freeze({
  dashboard: {
    theme: 'default',
    interval: 1,
    sound: true,
    compact: false,
    thresholds: {
      cpu: { warning: 70, critical: 90 },
      memory: { warning: 80, critical: 95 },
      temperature: { warning: 65, critical: 80 },
    },
  },
  api: { enabled: false, keyHash: null },
  wireguard: { enabled: false, interface: 'wg0' },
  services: [],
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function sanitizeString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, '').trim().slice(0, maxLength);
}

function clampNumber(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}

/**
 * Dashboard preferences come from the browser. Known keys are type-checked; unknown keys are
 * kept when they are plain JSON scalars so newer frontends can store their own preferences.
 */
export function sanitizeDashboardPatch(patch) {
  if (!isPlainObject(patch)) return {};
  const out = {};
  for (const [key, value] of Object.entries(patch)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (key === 'thresholds') {
      if (!isPlainObject(value)) continue;
      const thresholds = {};
      for (const [metric, levels] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(metric) || !isPlainObject(levels)) continue;
        const warning = clampNumber(levels.warning, 0, 1000);
        const critical = clampNumber(levels.critical, 0, 1000);
        if (warning !== null && critical !== null) thresholds[metric.slice(0, 30)] = { warning, critical };
      }
      out.thresholds = thresholds;
    } else if (key === 'interval') {
      const interval = clampNumber(value, 1, 3600);
      if (interval !== null) out.interval = interval;
    } else if (key === 'theme') {
      if (typeof value === 'string' && /^[a-z0-9_-]{1,30}$/i.test(value)) out.theme = value;
    } else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      out[key] = value;
    } else if (typeof value === 'string') {
      out[key] = sanitizeString(value, 200);
    }
  }
  return out;
}

export function validateService(service, limits) {
  const errors = [];
  if (!isPlainObject(service)) return { valid: false, errors: ['Service must be an object'] };

  if (!service.name || typeof service.name !== 'string') errors.push('Name is required');
  const port = Number.parseInt(service.port, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) errors.push('Valid port (1-65535) is required');
  if (service.path && typeof service.path !== 'string') errors.push('Path must be a string');
  if (service.host && typeof service.host !== 'string') errors.push('Host must be a string');
  if (service.checkType && !VALID_CHECK_TYPES.includes(service.checkType)) {
    errors.push(`Invalid checkType. Must be one of: ${VALID_CHECK_TYPES.join(', ')}`);
  }
  if (errors.length > 0) return { valid: false, errors };

  const sanitized = {
    name: sanitizeString(service.name, limits.maxNameLength),
    port,
    path: sanitizeString(service.path || '/', limits.maxPathLength),
    host: sanitizeString(service.host || 'localhost', limits.maxNameLength),
    checkType: inferCheckType(port, service.checkType),
    icon: inferIcon(port, sanitizeString(service.icon || '', 50)),
    enabled: service.enabled !== false,
  };
  if (typeof service.interface === 'string' && IFACE_NAME.test(service.interface)) {
    sanitized.interface = service.interface;
  }
  return { valid: true, sanitized };
}

function withDefaults(raw) {
  const data = isPlainObject(raw) ? raw : {};
  const dashboard = isPlainObject(data.dashboard) ? data.dashboard : {};
  return {
    ...data,
    dashboard: {
      ...DEFAULT_SETTINGS.dashboard,
      ...dashboard,
      thresholds: { ...DEFAULT_SETTINGS.dashboard.thresholds, ...(isPlainObject(dashboard.thresholds) ? dashboard.thresholds : {}) },
    },
    api: { ...DEFAULT_SETTINGS.api, ...(isPlainObject(data.api) ? data.api : {}) },
    wireguard: { ...DEFAULT_SETTINGS.wireguard, ...(isPlainObject(data.wireguard) ? data.wireguard : {}) },
    services: Array.isArray(data.services) ? data.services : [],
  };
}

/**
 * settings.json on disk is the source of truth (people edit it by hand). Reads are cached
 * and revalidated on mtime; writes are serialized and atomic.
 */
export class SettingsStore {
  #path;
  #cache = null;
  #mtime = 0;
  #queue = Promise.resolve();
  #warned = false;

  constructor(settingsPath) {
    this.#path = settingsPath;
  }

  get path() {
    return this.#path;
  }

  async load() {
    let stat;
    try {
      stat = await fs.promises.stat(this.#path);
    } catch {
      if (!this.#warned) {
        console.warn(`No settings file at ${this.#path}: using defaults until something is saved`);
        this.#warned = true;
      }
      return withDefaults({});
    }
    if (this.#cache && stat.mtimeMs === this.#mtime) return structuredClone(this.#cache);
    try {
      this.#cache = withDefaults(JSON.parse(await fs.promises.readFile(this.#path, 'utf-8')));
      this.#mtime = stat.mtimeMs;
    } catch (error) {
      console.warn(`Could not parse ${this.#path}: ${error.message}`);
      return withDefaults({});
    }
    return structuredClone(this.#cache);
  }

  /** Runs `mutate(settings)` against the latest state and persists the result. */
  update(mutate) {
    const run = this.#queue.then(async () => {
      const settings = await this.load();
      const result = await mutate(settings);
      await this.#write(settings);
      return result;
    });
    this.#queue = run.catch(() => {});
    return run;
  }

  async #write(settings) {
    const body = JSON.stringify(settings, null, 2);
    await fs.promises.mkdir(path.dirname(this.#path), { recursive: true });
    const tmp = `${this.#path}.tmp`;
    try {
      await fs.promises.writeFile(tmp, body);
      await fs.promises.rename(tmp, this.#path);
    } catch {
      // A settings file bind-mounted on its own cannot be replaced by rename.
      await fs.promises.rm(tmp, { force: true });
      await fs.promises.writeFile(this.#path, body);
    }
    this.#cache = null;
  }
}
