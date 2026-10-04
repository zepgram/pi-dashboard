import fs from 'node:fs';
import { IFACE_NAME } from './services-config.js';
import { run } from './util.js';

const ONLINE_THRESHOLD_SECONDS = 180;
const UNIT_SECONDS = { second: 1, minute: 60, hour: 3600, day: 86400 };
const UNIT_BYTES = { b: 1, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };

/** "1 minute, 12 seconds ago" → 72. */
export function parseHandshakeTime(text) {
  if (!text) return null;
  const parts = [...text.matchAll(/(\d+)\s*(second|minute|hour|day)/gi)];
  if (parts.length === 0) return null;
  return parts.reduce((total, [, value, unit]) => total + Number(value) * UNIT_SECONDS[unit.toLowerCase()], 0);
}

export function formatTimeAgo(seconds) {
  if (seconds === null || seconds === undefined) return 'never';
  if (seconds < 60) return `${seconds} sec ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} day ago`;
}

function parseTransfer(text, direction) {
  const match = new RegExp(`([\\d.]+)\\s*(B|KiB|MiB|GiB|TiB)\\s*${direction}`, 'i').exec(text);
  return match ? Math.round(Number.parseFloat(match[1]) * UNIT_BYTES[match[2].toLowerCase()]) : 0;
}

export function parseWgShow(output, interfaceName) {
  const result = { interface: { name: interfaceName, publicKey: null, listenPort: null }, peers: [] };
  let peer = null;
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    const value = line.slice(line.indexOf(':') + 1).trim();
    if (line.startsWith('peer:')) {
      peer = { publicKey: value, endpoint: null, lastHandshake: null, lastHandshakeSeconds: null, transfer: { received: 0, sent: 0 } };
      result.peers.push(peer);
    } else if (line.startsWith('public key:') && !peer) {
      result.interface.publicKey = value;
    } else if (line.startsWith('listening port:')) {
      result.interface.listenPort = Number.parseInt(value, 10);
    } else if (peer && line.startsWith('endpoint:')) {
      peer.endpoint = value;
    } else if (peer && line.startsWith('latest handshake:')) {
      peer.lastHandshakeSeconds = parseHandshakeTime(value);
      if (peer.lastHandshakeSeconds !== null) {
        peer.lastHandshake = Math.floor(Date.now() / 1000) - peer.lastHandshakeSeconds;
      }
    } else if (peer && line.startsWith('transfer:')) {
      peer.transfer = { received: parseTransfer(value, 'received'), sent: parseTransfer(value, 'sent') };
    }
  }
  return result;
}

/** Client names by public key, from `pivpn -l` output or PiVPN's clients.txt (name key ...). */
export function parseClientNames(text) {
  const names = new Map();
  for (const line of text.split('\n')) {
    const match = /^(\S+)\s+([A-Za-z0-9+/]{43}=)(\s|$)/.exec(line.trim());
    if (match) names.set(match[2], match[1]);
  }
  return names;
}

async function clientNames() {
  const listed = await run('pivpn', ['-l']);
  if (listed) return parseClientNames(listed);
  try {
    return parseClientNames(await fs.promises.readFile('/etc/wireguard/configs/clients.txt', 'utf-8'));
  } catch {
    return new Map();
  }
}

export async function getWireGuardData(settings) {
  const wg = settings?.wireguard || { enabled: false, interface: 'wg0' };
  if (!wg.enabled) return { enabled: false };

  const interfaceName = wg.interface || 'wg0';
  if (!IFACE_NAME.test(interfaceName)) {
    return { enabled: true, error: 'Invalid WireGuard interface name' };
  }

  const output = (await run('wg', ['show', interfaceName])) ?? (await run('sudo', ['-n', 'wg', 'show', interfaceName]));
  if (output === null) {
    return { enabled: true, error: `Failed to get WireGuard status: wg show ${interfaceName} failed (interface down, wireguard-tools missing or NET_ADMIN not granted)` };
  }

  const data = parseWgShow(output, interfaceName);
  const names = await clientNames();
  const clients = data.peers
    .map(peer => ({
      name: names.get(peer.publicKey) || 'unknown',
      publicKey: peer.publicKey,
      online: peer.lastHandshakeSeconds !== null && peer.lastHandshakeSeconds < ONLINE_THRESHOLD_SECONDS,
      endpoint: peer.endpoint || null,
      lastHandshake: peer.lastHandshake,
      lastHandshakeAgo: formatTimeAgo(peer.lastHandshakeSeconds),
      transfer: peer.transfer,
    }))
    .sort((a, b) => (a.online !== b.online ? (a.online ? -1 : 1) : a.name.localeCompare(b.name)));

  return { enabled: true, interface: data.interface, clients };
}
