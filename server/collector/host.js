import fs from 'node:fs';
import os from 'node:os';
import si from 'systeminformation';
import { cached, readInt, readText, round1, round2, run } from '../util.js';

/** Aggregate and per-core busy share since the previous call, from /proc/stat. */
export function createCpuSampler(procRoot) {
  let last = null;
  return function sample() {
    const text = readText(`${procRoot}/stat`);
    if (!text) return { usage: 0, cores: [] };
    const rows = text
      .split('\n')
      .filter(line => line.startsWith('cpu'))
      .map(line => {
        const v = line.split(/\s+/).slice(1).map(Number);
        const idle = v[3] + (v[4] || 0);
        return { total: v.reduce((a, b) => a + b, 0), idle };
      });
    const previous = last;
    last = rows;
    if (!previous || previous.length !== rows.length) return { usage: 0, cores: rows.slice(1).map(() => 0) };
    const pct = rows.map((row, i) => {
      const span = row.total - previous[i].total;
      return span > 0 ? round1(100 * (1 - (row.idle - previous[i].idle) / span)) : 0;
    });
    return { usage: pct[0], cores: pct.slice(1) };
  };
}

export function parseMeminfo(text) {
  const kb = {};
  for (const line of text.split('\n')) {
    const match = /^(\w+):\s+(\d+)/.exec(line);
    if (match) kb[match[1]] = Number(match[2]) * 1024;
  }
  const total = kb.MemTotal || 0;
  const available = kb.MemAvailable ?? kb.MemFree ?? 0;
  const buffcache = (kb.Buffers || 0) + (kb.Cached || 0) + (kb.SReclaimable || 0);
  const used = Math.max(0, total - available);
  const pct = n => (total > 0 ? round1((n / total) * 100) : 0);
  return {
    total,
    used,
    buffcache,
    free: available,
    percent: pct(used),
    usedPercent: pct(used),
    buffcachePercent: pct(buffcache),
  };
}

/** Bit meanings of the Raspberry Pi firmware throttle word (vcgencmd get_throttled). */
export function decodeThrottle(flags) {
  const reasons = [];
  if (flags & 0x1) reasons.push('Under-voltage');
  if (flags & 0x2) reasons.push('Freq capped');
  if (flags & 0x4) reasons.push('Throttled');
  if (flags & 0x8) reasons.push('Soft temp limit');
  if (flags & 0x10000) reasons.push('Under-voltage occurred');
  if (flags & 0x20000) reasons.push('Freq cap occurred');
  if (flags & 0x40000) reasons.push('Throttling occurred');
  if (flags & 0x80000) reasons.push('Soft temp limit occurred');
  return { throttled: (flags & 0xf) !== 0, flags, reasons };
}

/**
 * vcgencmd needs /dev/vcio, which a container only has when the device is passed through.
 * Without it the kernel still exposes the under-voltage alarm through hwmon.
 */
export function createThrottleReader(sysRoot) {
  let alarmFile;
  function underVoltageAlarm() {
    if (alarmFile === undefined) {
      alarmFile = null;
      try {
        for (const entry of fs.readdirSync(`${sysRoot}/class/hwmon`)) {
          const dir = `${sysRoot}/class/hwmon/${entry}`;
          if (readText(`${dir}/name`)?.trim() === 'rpi_volt') alarmFile = `${dir}/in0_lcrit_alarm`;
        }
      } catch {
        // no hwmon tree
      }
    }
    return alarmFile ? readInt(alarmFile) === 1 : false;
  }
  return cached(5000, async () => {
    const output = await run('vcgencmd', ['get_throttled'], { timeout: 1000 });
    const match = output && /throttled=(0x[0-9a-fA-F]+)/.exec(output);
    if (match) return decodeThrottle(Number.parseInt(match[1], 16));
    return decodeThrottle(underVoltageAlarm() ? 0x1 : 0);
  });
}

export function createTemperatureReader(sysRoot) {
  const zone = `${sysRoot}/class/thermal/thermal_zone0/temp`;
  const fallback = cached(2000, () => si.cpuTemperature().catch(() => ({ main: 0, max: 0 })));
  return async function read() {
    const milli = readInt(zone);
    if (milli !== null) {
      const main = round1(milli / 1000);
      return { main, max: main };
    }
    const temp = await fallback();
    return { main: temp.main || 0, max: temp.max || temp.main || 0 };
  };
}

const BASE_FREQ_MHZ = [['Pi 5', 2400], ['Pi 4', 1500], ['Pi 3', 1200]];

export function readOverclock(hostRoot, sysRoot) {
  let configured = null;
  for (const file of [`${hostRoot}/boot/firmware/config.txt`, `${hostRoot}/boot/config.txt`]) {
    const match = /^arm_freq=(\d+)/m.exec(readText(file) || '');
    if (match) {
      configured = Number.parseInt(match[1], 10);
      break;
    }
  }
  if (!configured) return { configured: null, base: null, overclocked: false };
  const model = (readText(`${sysRoot}/firmware/devicetree/base/model`) || '').replace(/\0/g, '');
  const base = BASE_FREQ_MHZ.find(([name]) => model.includes(name))?.[1] ?? 1500;
  return { configured, base, overclocked: configured > base };
}

/** Average current frequency and hardware maximum across cores, in GHz. */
export function readCpuFrequency(sysRoot) {
  const cpuDir = `${sysRoot}/devices/system/cpu`;
  const current = [];
  let max = 0;
  for (let i = 0; i < os.cpus().length; i++) {
    const cur = readInt(`${cpuDir}/cpu${i}/cpufreq/scaling_cur_freq`);
    if (cur !== null) current.push(cur);
    max = Math.max(max, readInt(`${cpuDir}/cpu${i}/cpufreq/cpuinfo_max_freq`) || 0);
  }
  const avg = current.length ? current.reduce((a, b) => a + b, 0) / current.length : 0;
  return { speed: round2(avg / 1e6), speedMax: round2(max / 1e6) };
}

const VIRTUAL_IFACE = /^(lo|docker\d+|veth.*|br-.*)$/;

/** Byte counters per physical/VPN interface, with rates since the previous call. */
export function createNetworkSampler(procRoot) {
  const previous = new Map();
  let previousAt = 0;
  return function sample() {
    // PID 1's view is the host network namespace even when the container has its own.
    const text = readText(`${procRoot}/1/net/dev`) ?? readText(`${procRoot}/net/dev`);
    if (!text) return [];
    const now = Date.now();
    const seconds = previousAt ? (now - previousAt) / 1000 : 0;
    const stats = [];
    for (const line of text.trim().split('\n').slice(2)) {
      const [iface, ...fields] = line.trim().split(/[:\s]+/);
      if (fields.length < 10 || VIRTUAL_IFACE.test(iface)) continue;
      const rxBytes = Number(fields[0]) || 0;
      const txBytes = Number(fields[8]) || 0;
      const last = previous.get(iface);
      const rate = (cur, old) => (last && seconds > 0 ? Math.max(0, Math.round((cur - old) / seconds)) : 0);
      stats.push({ iface, rxBytes, txBytes, rxSec: rate(rxBytes, last?.rxBytes), txSec: rate(txBytes, last?.txBytes) });
      previous.set(iface, { rxBytes, txBytes });
    }
    previousAt = now;
    return stats;
  };
}

export function describeInterfaces(stats) {
  const addresses = os.networkInterfaces();
  return stats.map(({ iface }) => {
    const v4 = (addresses[iface] || []).find(a => a.family === 'IPv4');
    return {
      name: iface,
      ip4: v4?.address || 'N/A',
      mac: v4?.mac || '',
      type: /^(wg|tun|tap)/.test(iface) ? 'vpn' : iface.startsWith('wl') ? 'wireless' : 'wired',
      speed: 0,
    };
  });
}

export function parseOsRelease(text) {
  const info = {};
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) info[line.slice(0, eq)] = line.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return info;
}

async function countUpgradable(hostRoot) {
  // In the container, apt lives on the host: run it from the read-only host root.
  const output = hostRoot
    ? await run('chroot', [hostRoot, 'apt', 'list', '--upgradable'], { timeout: 30000 })
    : await run('apt', ['list', '--upgradable'], { timeout: 30000 });
  if (!output) return 0;
  return output.split('\n').filter(line => line.includes('[upgradable')).length;
}

/** Slow-changing facts about the host OS, refreshed hourly. */
export function createOsInfoReader(hostRoot) {
  return cached(3600_000, async () => {
    const info = parseOsRelease(readText(`${hostRoot}/etc/os-release`) || '');
    let distro = info.PRETTY_NAME || info.NAME || 'Linux';
    let version = info.VERSION_ID || '';
    const rpiIssue = readText(`${hostRoot}/etc/rpi-issue`);
    if (rpiIssue?.includes('Raspberry Pi')) {
      version = /(\d{4}-\d{2}-\d{2})/.exec(rpiIssue)?.[1] ?? version;
      distro = `Raspberry Pi OS${info.VERSION_CODENAME ? ` (${info.VERSION_CODENAME})` : ''}`;
    }
    return {
      platform: os.platform(),
      distro,
      version,
      release: info.VERSION_ID || '',
      codename: info.VERSION_CODENAME || '',
      hostname: readText(`${hostRoot}/etc/hostname`)?.trim() || os.hostname(),
      arch: os.arch() === 'arm64' ? 'arm64' : os.arch(),
      updatesAvailable: await countUpgradable(hostRoot),
    };
  });
}

export function readLoad(procRoot) {
  const loadAvg = (readText(`${procRoot}/loadavg`) || '').split(' ').slice(0, 3).map(Number);
  const uptime = Number.parseFloat((readText(`${procRoot}/uptime`) || '0').split(' ')[0]) || os.uptime();
  const load = loadAvg.length === 3 && loadAvg.every(Number.isFinite) ? loadAvg : os.loadavg();
  return { avgLoad: load[0], uptime, loadAvg: load.map(round2) };
}
