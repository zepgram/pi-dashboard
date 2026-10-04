// Top status strip: overall health, connection state and footer facts.
import { byId, setAttr, setText } from './dom.js';
import { on } from './bus.js';
import { clock, isNum, percent } from './format.js';
import { levelFor, state } from './state.js';

const RANK = { ok: 0, warn: 1, crit: 2 };
const LABEL = { ok: 'Nominal', warn: 'Warning', crit: 'Critical' };

export function assess(stats, services) {
  const issues = [];
  const add = (level, text) => level !== 'ok' && issues.push({ level, text });

  add(levelFor('cpu', stats.cpu?.usage), `CPU ${percent(stats.cpu?.usage, 0)}%`);
  add(levelFor('memory', stats.memory?.percent), `Memory ${percent(stats.memory?.percent, 0)}%`);
  const temp = stats.temperature?.main;
  if (isNum(temp) && temp > 0) add(levelFor('temperature', temp), `Temp ${Math.round(temp)}°C`);
  if (stats.temperature?.throttled) add('crit', 'Throttled');
  for (const disk of stats.disks || []) add(levelFor('disk', disk.percent), `Disk ${disk.mount} ${percent(disk.percent, 0)}%`);

  const unhealthy = (stats.containers || []).filter((c) => c.health === 'unhealthy').length;
  if (unhealthy) add('warn', `${unhealthy} container${unhealthy > 1 ? 's' : ''} unhealthy`);
  const down = (services || []).filter((s) => s.status && s.status !== 'online').length;
  if (down) add('warn', `${down} service${down > 1 ? 's' : ''} down`);

  issues.sort((a, b) => RANK[b.level] - RANK[a.level]);
  const level = issues.length ? issues[0].level : 'ok';
  return { level, issues };
}

function renderHealth() {
  const health = byId('health');
  if (!state.online) {
    const offline = state.online === false;
    setAttr(health, 'data-level', offline ? 'off' : 'idle');
    setText(byId('health-label'), offline ? 'Offline' : 'Init');
    setText(byId('health-detail'), offline ? 'No response from the server, retrying' : 'Waiting for first sample');
    return;
  }
  const { level, issues } = assess(state.stats, state.services);
  setAttr(health, 'data-level', level);
  setText(byId('health-label'), LABEL[level]);
  setText(byId('health-detail'), issues.length ? issues.map((i) => i.text).join(' · ') : 'All systems nominal');
}

function renderConnection() {
  const conn = byId('conn');
  const mode = state.online === null ? 'connecting' : !state.online ? 'offline' : state.paused ? 'paused' : 'live';
  setAttr(conn, 'data-state', mode);
  setText(byId('conn-text'), { live: 'Live', paused: 'Paused', offline: 'Offline', connecting: 'Connecting' }[mode]);
  // Stale data stays on screen but is visibly dimmed until the server answers again.
  setAttr(byId('main'), 'data-stale', String(!state.online));
}

export function initStatus() {
  on('stats', (stats) => {
    const os = stats.os || {};
    setText(byId('hostname'), os.hostname || '--');
    if (os.hostname) document.title = `${os.hostname} · Pi Dashboard`;
    setText(byId('foot-os'), [os.distro, os.release].filter(Boolean).join(' ') || '--');
    setText(byId('foot-arch'), os.arch || '');
    setText(byId('foot-version'), stats.version ? `v${String(stats.version).replace(/^v/, '')}` : '');
    setText(byId('foot-updated'), clock(stats._time));
    renderHealth();
  });
  on('services', renderHealth);
  on('settings', () => state.stats && renderHealth());
  on('connection', () => {
    renderHealth();
    renderConnection();
  });
  on('pause', renderConnection);
  renderConnection();
}
