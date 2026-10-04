import { KNOWN_PROCESSES, KNOWN_SERVICES } from './services-config.js';
import { run } from './util.js';

const UDP_SERVICES = new Set([500, 1194, 1723, 4500, 51820]);

async function listening(flag) {
  return (await run('ss', [flag])) ?? (await run('netstat', [flag])) ?? '';
}

/** "192.168.1.5:80", "*:22", "[::]:22", ":::22", "127.0.0.53%lo:53" → { address, port }. */
function parseLocal(column) {
  const match = /^(.*):(\d+)$/.exec(column || '');
  if (!match) return null;
  const address = match[1].replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  return { address, port: Number.parseInt(match[2], 10) };
}

const isLoopback = address => address.startsWith('127.') || address === '::1';
const isWildcard = address => ['0.0.0.0', '*', '::', ''].includes(address);

/** Parses `ss -tlnp` / `netstat -tlnp` output into service suggestions. */
export function parseListeningTcp(output) {
  const discovered = [];
  const seen = new Set();
  for (const line of output.split('\n')) {
    if (!line.includes('LISTEN')) continue;
    // Both tools print the local address in the fourth column.
    const local = parseLocal(line.trim().split(/\s+/)[3]);
    // A service bound to loopback only is not worth a health tile.
    if (!local || isLoopback(local.address)) continue;
    const { port } = local;
    if (port > 32767 || seen.has(port)) continue;
    seen.add(port);

    const processName = /users:\(\("([^"]+)"/.exec(line)?.[1] ?? null;
    let known = (processName && KNOWN_PROCESSES[processName]) || KNOWN_SERVICES[port];
    if (!known && port < 10000) {
      known = { name: processName || `Port ${port}`, icon: 'server', checkType: 'tcp', path: '/' };
    }
    if (!known) continue;
    discovered.push({
      name: known.name,
      port,
      path: known.path || '/',
      // Bound to one address only: that is where the check has to connect.
      host: isWildcard(local.address) ? 'localhost' : local.address,
      icon: known.icon || 'server',
      checkType: known.checkType || 'tcp',
      enabled: true,
      discovered: true,
      process: processName,
    });
  }
  return { discovered, seen };
}

export function parseListeningUdp(output, seen = new Set()) {
  const discovered = [];
  for (const line of output.split('\n')) {
    const local = parseLocal(line.trim().split(/\s+/)[3]);
    if (!local) continue;
    const { port } = local;
    const known = KNOWN_SERVICES[port];
    if (seen.has(port) || !UDP_SERVICES.has(port) || !known) continue;
    seen.add(port);
    discovered.push({
      name: known.name,
      port,
      path: known.interface || '',
      host: 'localhost',
      icon: known.icon,
      checkType: known.checkType,
      ...(known.interface ? { interface: known.interface } : {}),
      enabled: true,
      discovered: true,
      protocol: 'udp',
    });
  }
  return discovered;
}

export async function discoverServices() {
  const tcp = parseListeningTcp(await listening('-tlnp'));
  const udp = parseListeningUdp(await listening('-ulnp'), tcp.seen);
  return [...tcp.discovered, ...udp].sort((a, b) => a.port - b.port);
}
