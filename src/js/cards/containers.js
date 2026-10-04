import { $$, byId, el, setAttr, setText, setWidth, show, syncList } from '../dom.js';
import { on } from '../bus.js';
import { bytes, duration, isNum, percent } from '../format.js';
import { state } from '../state.js';

const SORT_KEY = 'piDashboardContainerSort';
const STATE_RANK = { unhealthy: 0, restarting: 1, starting: 2, paused: 3, exited: 4, dead: 4, created: 5, running: 6 };

const sorters = {
  name: (c) => c.name.toLowerCase(),
  state: (c) => STATE_RANK[displayState(c)] ?? 5,
  cpu: (c) => c.cpuPercent || 0,
  mem: (c) => c.memPercent || 0,
  started: (c) => c.started || 0
};
const DEFAULT_DIR = { name: 1, state: 1, cpu: -1, mem: -1, started: -1 };

function displayState(c) {
  if (c.state === 'running' && (c.health === 'unhealthy' || c.health === 'starting')) return c.health;
  return c.state || 'unknown';
}

function loadSort() {
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_KEY));
    if (saved && sorters[saved.key]) return saved;
  } catch {
    /* ignore */
  }
  return { key: 'name', dir: 1 };
}

export function initContainers() {
  const body = byId('containers');
  const table = byId('containers-table');
  let sort = loadSort();

  function markHeaders() {
    for (const button of $$('.sort', table)) {
      const active = button.dataset.sort === sort.key;
      setAttr(button.parentNode, 'aria-sort', active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none');
    }
  }

  function render(stats) {
    const containers = Array.isArray(stats.containers) ? stats.containers : [];
    const running = containers.filter((c) => c.state === 'running').length;
    const unhealthy = containers.filter((c) => c.health === 'unhealthy').length;
    show(byId('containers-empty'), containers.length === 0);
    show(table.parentNode, containers.length > 0);
    const count = byId('containers-count');
    show(count, containers.length > 0);
    setText(count, `${running}/${containers.length} running${unhealthy ? ` · ${unhealthy} unhealthy` : ''}`);
    setAttr(count, 'data-level', unhealthy ? 'crit' : 'ok');

    const value = sorters[sort.key];
    const sorted = [...containers].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.name.localeCompare(b.name);
    });
    const now = Date.now() / 1000;

    syncList(
      body,
      sorted,
      (c) => c.id || c.name,
      () =>
        el(
          'tr',
          {},
          el('td', { class: 'cell-name' }, el('span', { class: 'lamp', 'aria-hidden': 'true' }), el('span', { class: 'cell-main' })),
          el('td', { class: 'mono dim col-image' }),
          el('td', { class: 'cell-state' }),
          el('td', { class: 'r' }, el('span', { class: 'meter' }, el('span', { class: 'bar' }, el('i')), el('span', { class: 'mono' }))),
          el('td', { class: 'r' }, el('span', { class: 'meter' }, el('span', { class: 'bar bar-2' }, el('i')), el('span', { class: 'mono' }))),
          el('td', { class: 'r mono dim col-up' })
        ),
      (row, c) => {
        const [name, image, stateCell, cpu, mem, up] = row.children;
        const shown = displayState(c);
        setAttr(row, 'data-state', shown);
        setText(name.lastChild, c.name);
        setAttr(name.lastChild, 'title', c.name);
        setText(image, c.image);
        setAttr(image, 'title', c.image || '');
        setText(stateCell, shown);
        const isRunning = c.state === 'running';
        setWidth(cpu.firstChild.firstChild.firstChild, isRunning ? c.cpuPercent : 0);
        setText(cpu.firstChild.lastChild, isRunning && isNum(c.cpuPercent) ? `${c.cpuPercent.toFixed(1)}%` : '--');
        setWidth(mem.firstChild.firstChild.firstChild, isRunning ? c.memPercent : 0);
        setText(mem.firstChild.lastChild, isRunning && isNum(c.memPercent) ? `${percent(c.memPercent)}%` : '--');
        setAttr(mem, 'title', isRunning && isNum(c.memUsage) ? bytes(c.memUsage) : '');
        setText(up, isRunning && c.started ? duration(now - c.started) : '--');
      }
    );
  }

  table.tHead.addEventListener('click', (event) => {
    const button = event.target.closest('.sort');
    if (!button) return;
    const key = button.dataset.sort;
    sort = sort.key === key ? { key, dir: -sort.dir } : { key, dir: DEFAULT_DIR[key] };
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify(sort));
    } catch {
      /* ignore */
    }
    markHeaders();
    if (state.stats) render(state.stats);
  });

  markHeaders();
  on('stats', render);
}
