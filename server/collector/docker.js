import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { readInt, readText, round1 } from '../util.js';

const NUM_CPUS = os.cpus().length;

function dockerGet(socketPath, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path, method: 'GET' }, res => {
      let body = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`Docker API ${res.statusCode}`));
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('Docker API timeout')));
    req.on('error', reject);
    req.end();
  });
}

/** "Up 3 hours (healthy)" → "healthy". */
export function parseHealth(status) {
  const match = /\((healthy|unhealthy|health: starting)\)/.exec(status || '');
  if (!match) return null;
  return match[1] === 'health: starting' ? 'starting' : match[1];
}

/** Where a container's cgroup lives depends on the cgroup version and Docker's cgroup driver. */
function cgroupDirs(cgroupRoot, id) {
  return {
    v2: [`${cgroupRoot}/system.slice/docker-${id}.scope`, `${cgroupRoot}/docker/${id}`],
    v1cpu: [`${cgroupRoot}/cpu,cpuacct/docker/${id}`, `${cgroupRoot}/cpu,cpuacct/system.slice/docker-${id}.scope`],
    v1mem: [`${cgroupRoot}/memory/docker/${id}`, `${cgroupRoot}/memory/system.slice/docker-${id}.scope`],
  };
}

function readCpuUsageUsec(dirs) {
  for (const dir of dirs.v2) {
    const match = /usage_usec\s+(\d+)/.exec(readText(`${dir}/cpu.stat`) || '');
    if (match) return Number(match[1]);
  }
  for (const dir of dirs.v1cpu) {
    const ns = readInt(`${dir}/cpuacct.usage`);
    if (ns !== null) return ns / 1000;
  }
  return null;
}

function rssOf(procRoot, pid) {
  const match = /VmRSS:\s+(\d+)/.exec(readText(`${procRoot}/${pid}/status`) || '');
  return match ? Number(match[1]) * 1024 : 0;
}

/**
 * Raspberry Pi OS ships with the memory cgroup controller off, so memory.current is often
 * missing. The process list of the cgroup is always there: sum the resident sets.
 */
function readMemoryBytes(dirs, procRoot, mainPid) {
  for (const dir of dirs.v2) {
    const current = readInt(`${dir}/memory.current`);
    if (current !== null) {
      const inactiveFile = /inactive_file\s+(\d+)/.exec(readText(`${dir}/memory.stat`) || '');
      return Math.max(0, current - (inactiveFile ? Number(inactiveFile[1]) : 0));
    }
  }
  for (const dir of dirs.v1mem) {
    const usage = readInt(`${dir}/memory.usage_in_bytes`);
    if (usage !== null) return usage;
  }
  for (const dir of dirs.v2) {
    const procs = readText(`${dir}/cgroup.procs`);
    if (!procs) continue;
    const pids = procs.split('\n').filter(pid => pid && pid !== '0');
    if (pids.length) return pids.reduce((sum, pid) => sum + rssOf(procRoot, pid), 0);
  }
  return mainPid ? rssOf(procRoot, mainPid) : 0;
}

export function createDockerSampler({ socketPath, procRoot, sysRoot }) {
  const cgroupRoot = `${sysRoot}/fs/cgroup`;
  const cpuPrevious = new Map();
  // Start time and main PID only change when a container (re)starts.
  const inspected = new Map();
  let available = fs.existsSync(socketPath);

  async function inspect(container) {
    const key = `${container.State}:${container.Status.replace(/\d+ \w+/, '')}`;
    const hit = inspected.get(container.Id);
    if (hit && hit.key === key) return hit;
    let started = 0;
    let pid = 0;
    try {
      const info = await dockerGet(socketPath, `/containers/${container.Id}/json`);
      started = Math.floor(Date.parse(info.State?.StartedAt) / 1000) || 0;
      pid = info.State?.Pid || 0;
    } catch {
      // removed in between
    }
    const entry = { key, started, pid };
    inspected.set(container.Id, entry);
    return entry;
  }

  return async function sample() {
    if (!available) {
      available = fs.existsSync(socketPath);
      if (!available) return [];
    }
    let list;
    try {
      list = await dockerGet(socketPath, '/containers/json?all=true');
    } catch (error) {
      console.error('Docker API error:', error.message);
      return [];
    }
    const memTotal = (Number(/MemTotal:\s+(\d+)/.exec(readText(`${procRoot}/meminfo`) || '')?.[1]) || 0) * 1024;
    const now = process.hrtime.bigint();
    const live = new Set();
    const containers = [];

    for (const container of list) {
      const id = container.Id;
      live.add(id);
      const running = container.State === 'running';
      const { started, pid } = await inspect(container);
      let cpuPercent = 0;
      let memUsage = 0;
      if (running) {
        const dirs = cgroupDirs(cgroupRoot, id);
        const usage = readCpuUsageUsec(dirs);
        const previous = cpuPrevious.get(id);
        if (usage !== null) {
          cpuPrevious.set(id, { usage, at: now });
          if (previous && usage >= previous.usage) {
            const elapsedUsec = Number(now - previous.at) / 1000;
            // 100 % means every core is busy, like the host CPU gauge.
            if (elapsedUsec > 0) cpuPercent = round1(((usage - previous.usage) / elapsedUsec) * 100 / NUM_CPUS);
          }
        }
        memUsage = readMemoryBytes(dirs, procRoot, pid);
      }
      containers.push({
        id,
        name: (container.Names?.[0] || id.slice(0, 12)).replace(/^\//, ''),
        image: container.Image,
        state: container.State,
        status: container.Status,
        health: parseHealth(container.Status),
        started,
        cpuPercent,
        memPercent: memTotal ? round1((memUsage / memTotal) * 100) : 0,
        memUsage,
        memLimit: memTotal,
        netIO: { rx: 0, tx: 0 },
        blockIO: { r: 0, w: 0 },
      });
    }

    for (const id of cpuPrevious.keys()) if (!live.has(id)) cpuPrevious.delete(id);
    for (const id of inspected.keys()) if (!live.has(id)) inspected.delete(id);
    return containers;
  };
}
