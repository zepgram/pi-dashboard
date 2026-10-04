// Fetch loops. One request at a time per loop, paused when the tab is hidden.
import { api } from './api.js';
import { emit, on } from './bus.js';
import { state } from './state.js';
import { push, seed } from './series.js';

const SLOW_INTERVAL_MS = 10000;
const OFFLINE_AFTER = 2;

let fastTimer = null;
let slowTimer = null;
let failures = 0;
let busy = false;

function sample(stats) {
  const time = stats.timestamp || Date.now();
  const ifaces = stats.network?.interfaces || [];
  const physical = new Set(ifaces.filter((i) => i.type !== 'vpn').map((i) => i.name));
  let rx = 0;
  let tx = 0;
  for (const s of stats.network?.stats || []) {
    if (physical.size && !physical.has(s.iface)) continue;
    rx += s.rxSec || 0;
    tx += s.txSec || 0;
  }
  const temp = stats.temperature?.main;
  push('cpu', time, stats.cpu?.usage);
  push('memory', time, stats.memory?.percent);
  push('temperature', time, temp > 0 ? temp : null);
  push('load', time, stats.load?.loadAvg?.[0] ?? stats.load?.avgLoad);
  push('rx', time, rx);
  push('tx', time, tx);
  stats._time = time;
  stats._net = { rx, tx };
}

function setOnline(online) {
  if (state.online === online) return;
  state.online = online;
  emit('connection', online);
}

export async function refreshStats() {
  if (busy) return;
  busy = true;
  try {
    const stats = await api.get('/api/stats', { timeout: Math.max(5000, state.settings.interval * 2000) });
    failures = 0;
    sample(stats);
    state.stats = stats;
    setOnline(true);
    emit('stats', stats);
  } catch (error) {
    failures++;
    if (failures >= OFFLINE_AFTER || !state.stats) setOnline(false);
    emit('stats-error', error);
  } finally {
    busy = false;
  }
}

export async function refreshServices() {
  try {
    const services = await api.get('/api/services', { timeout: 20000 });
    state.services = Array.isArray(services) ? services : [];
    emit('services', state.services);
  } catch (error) {
    emit('services-error', error);
  }
}

const active = () => !state.paused && !document.hidden;

function scheduleFast() {
  clearTimeout(fastTimer);
  if (!active()) return;
  const delay = state.online ? state.settings.interval * 1000 : Math.max(3000, state.settings.interval * 1000);
  fastTimer = setTimeout(async () => {
    await refreshStats();
    scheduleFast();
  }, delay);
}

function scheduleSlow() {
  clearTimeout(slowTimer);
  if (!active()) return;
  slowTimer = setTimeout(async () => {
    await refreshServices();
    emit('slow-tick');
    scheduleSlow();
  }, SLOW_INTERVAL_MS);
}

async function resume() {
  if (!active()) return;
  await Promise.all([refreshStats(), refreshServices()]);
  emit('slow-tick');
  scheduleFast();
  scheduleSlow();
}

async function probeHistory() {
  try {
    const history = await api.get('/api/history?range=1h');
    state.historyAvailable = Array.isArray(history?.series?.cpu);
    if (state.historyAvailable) seed(history);
  } catch {
    state.historyAvailable = false;
  }
  emit('history-available', state.historyAvailable);
}

export async function startPolling() {
  on('pause', (paused) => {
    clearTimeout(fastTimer);
    clearTimeout(slowTimer);
    if (!paused) resume();
  });
  on('settings', scheduleFast);
  document.addEventListener('visibilitychange', () => {
    clearTimeout(fastTimer);
    clearTimeout(slowTimer);
    resume();
  });
  await probeHistory();
  await resume();
}
