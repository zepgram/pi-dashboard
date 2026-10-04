import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf-8'));

export const VERSION = pkg.version;
export const ROOT_DIR = path.join(here, '..');

/**
 * Inside the container the host is mounted under /host (see docker-compose.yml).
 * Running straight on the host, the same paths resolve to the real ones.
 */
function hostDir(inContainer, onHost) {
  return fs.existsSync(inContainer) ? inContainer : onHost;
}

export function loadConfig(env = process.env) {
  const hostRoot = fs.existsSync('/host/root/etc') ? '/host/root' : '';
  return {
    port: Number.parseInt(env.PORT, 10) || 3001,
    settingsPath: env.SETTINGS_CONFIG || path.join(ROOT_DIR, 'settings.json'),
    corsOrigins: env.CORS_ORIGINS
      ? env.CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
      : ['http://localhost:5173', 'http://localhost:3001'],
    adminToken: env.ADMIN_TOKEN || null,
    dockerSocket: env.DOCKER_SOCKET || '/var/run/docker.sock',
    distPath: path.join(ROOT_DIR, 'dist'),
    host: {
      root: hostRoot,
      inContainer: hostRoot !== '',
      proc: hostDir('/host/proc', '/proc'),
      sys: hostDir('/host/sys', '/sys'),
    },
    limits: { maxServices: 50, maxNameLength: 100, maxPathLength: 200 },
  };
}
