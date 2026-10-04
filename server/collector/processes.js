import fs from 'node:fs';
import { readText, round1 } from '../util.js';

const CLK_TCK = 100;

/** /proc/[pid]/stat: the command sits in parentheses and may itself contain spaces or ")". */
export function parseProcStat(text) {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0 || close < 0) return null;
  const rest = text.slice(close + 2).split(' ');
  return {
    name: text.slice(open + 1, close),
    state: rest[0],
    ticks: Number(rest[11]) + Number(rest[12]),
    startTicks: Number(rest[19]),
  };
}

/** Elapsed time in ps "etime" format: [[dd-]hh:]mm:ss. */
export function formatElapsed(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const pad = n => String(n).padStart(2, '0');
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const tail = `${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  if (days) return `${days}-${pad(hours)}:${tail}`;
  return hours ? `${pad(hours)}:${tail}` : tail;
}

/**
 * Top processes by CPU over the interval between two calls (what `top` shows), not the
 * lifetime average `ps` reports. 100 % is one full core.
 */
export function createProcessSampler(procRoot, limit = 10) {
  let previous = new Map();
  let previousAt = 0;

  return function sample() {
    let entries;
    try {
      entries = fs.readdirSync(procRoot);
    } catch {
      return [];
    }
    const now = Date.now();
    const seconds = previousAt ? (now - previousAt) / 1000 : 0;
    const uptime = Number.parseFloat((readText(`${procRoot}/uptime`) || '0').split(' ')[0]);
    const memTotalKb = Number(/MemTotal:\s+(\d+)/.exec(readText(`${procRoot}/meminfo`) || '')?.[1]) || 0;
    const current = new Map();
    const rows = [];

    for (const entry of entries) {
      if (entry.charCodeAt(0) < 48 || entry.charCodeAt(0) > 57) continue;
      const stat = readText(`${procRoot}/${entry}/stat`);
      const parsed = stat && parseProcStat(stat);
      if (!parsed) continue;
      const pid = Number(entry);
      current.set(pid, parsed.ticks);
      const before = previous.get(pid);
      if (pid <= 2 || before === undefined || seconds <= 0) continue;
      const cpu = ((parsed.ticks - before) / CLK_TCK / seconds) * 100;
      rows.push({ pid, cpu, ...parsed });
    }
    previous = current;
    previousAt = now;

    rows.sort((a, b) => b.cpu - a.cpu);
    return rows.slice(0, limit).map(row => {
      const rssKb = Number(/VmRSS:\s+(\d+)/.exec(readText(`${procRoot}/${row.pid}/status`) || '')?.[1]) || 0;
      const cmdline = (readText(`${procRoot}/${row.pid}/cmdline`) || '').replace(/\0/g, ' ').trim();
      return {
        pid: row.pid,
        name: row.name.slice(0, 20),
        cpu: round1(Math.max(0, row.cpu)),
        mem: memTotalKb ? round1((rssKb / memTotalKb) * 100) : 0,
        state: row.state,
        time: formatElapsed(uptime - row.startTicks / CLK_TCK),
        cmd: (cmdline || row.name).slice(0, 80),
      };
    });
  };
}
