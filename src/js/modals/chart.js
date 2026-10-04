// Large chart modal: LIVE uses the client buffers, 1H / 24H use /api/history.
import { $$, byId, el, setText, show } from '../dom.js';
import { api } from '../api.js';
import { on } from '../bus.js';
import { createChart } from '../charts.js';
import { fixed, percent, rate } from '../format.js';
import { fromHistory, live, LIVE_WINDOW_MS, summarize } from '../series.js';
import { state } from '../state.js';
import { liveGap, thresholdLines } from '../cards/metric.js';
import { openDialog } from './dialog.js';

const HISTORY_REFRESH_MS = 30000;

const tempColor = () => {
  const t = state.settings.thresholds.temperature;
  const now = state.stats?.temperature?.main ?? 0;
  return now >= t.critical ? '--crit' : now >= t.warning ? '--warn' : '--ok';
};

export const METRICS = {
  cpu: {
    title: 'CPU usage',
    series: () => [{ key: 'cpu', color: '--accent', label: 'CPU' }],
    scale: () => ({ min: 0, max: 100 }),
    format: (v) => `${percent(v)}%`,
    thresholds: () => thresholdLines('cpu')
  },
  memory: {
    title: 'Memory usage',
    series: () => [{ key: 'memory', color: '--accent-2', label: 'Memory' }],
    scale: () => ({ min: 0, max: 100 }),
    format: (v) => `${percent(v)}%`,
    thresholds: () => thresholdLines('memory')
  },
  temperature: {
    title: 'Temperature',
    series: () => [{ key: 'temperature', color: tempColor(), label: 'Temp' }],
    scale: () => ({ min: 20, max: Math.max(90, state.settings.thresholds.temperature.critical + 10) }),
    format: (v) => `${fixed(v)}°C`,
    thresholds: () => thresholdLines('temperature')
  },
  network: {
    title: 'Network throughput',
    series: () => [
      { key: 'rx', color: '--accent', label: 'RX' },
      { key: 'tx', color: '--accent-2', label: 'TX' }
    ],
    scale: () => ({ min: 0, max: null, minMax: 1024, base: 1024 }),
    format: rate,
    thresholds: () => []
  },
  load: {
    title: 'Load average (1 min)',
    series: () => [{ key: 'load', color: '--accent', label: 'Load' }],
    scale: () => ({ min: 0, max: null, minMax: 1 }),
    format: (v) => fixed(v, 2),
    thresholds: () => [{ value: state.stats?.cpu?.cores?.length || 1, color: '--warn' }]
  }
};

let chart = null;
let metric = 'cpu';
let range = 'live';
let history = null;
let historyAt = 0;
let requestId = 0;

const isOpen = () => byId('dlg-chart').open;

function note(text) {
  show(byId('chart-note'), Boolean(text));
  setText(byId('chart-note'), text || '');
}

function renderReadout(sets, format) {
  byId('chart-readout').replaceChildren(
    ...sets.map(({ label, color, summary }) =>
      el(
        'div',
        { class: 'readout-row' },
        el('span', { class: 'readout-name' }, el('i', { class: 'sw', style: `background:var(${color})` }), label),
        ...[
          ['Now', 'last'],
          ['Min', 'min'],
          ['Avg', 'avg'],
          ['Max', 'max']
        ].map(([name, field]) => el('div', {}, el('dt', { text: name }), el('dd', { text: summary ? format(summary[field]) : '--' })))
      )
    )
  );
}

function draw() {
  if (!isOpen() || !chart) return;
  const config = METRICS[metric];
  const defs = config.series();
  chart.setOptions({ minMax: undefined, base: 10, ...config.scale(), format: config.format });

  let from;
  let to;
  let gap;
  let sets;
  if (range === 'live') {
    to = state.stats?._time || Date.now();
    from = to - LIVE_WINDOW_MS;
    gap = liveGap();
    sets = defs.map((d) => ({ ...d, ...live[d.key] }));
  } else {
    if (!history) return;
    from = history.from;
    to = history.to;
    gap = history.step * 1500;
    sets = defs.map((d) => ({ ...d, ...fromHistory(history, d.key) }));
  }

  chart.setData({ series: sets, from, to, gap, thresholds: config.thresholds(), nowDot: range === 'live' });
  renderReadout(
    sets.map((s) => ({ label: s.label, color: s.color, summary: summarize(s, from, to) })),
    config.format
  );
}

async function loadHistory() {
  const id = ++requestId;
  const wanted = range;
  try {
    const data = await api.get(`/api/history?range=${wanted}`, { timeout: 20000 });
    if (id !== requestId || range !== wanted) return;
    history = data;
    historyAt = Date.now();
    note('');
    draw();
  } catch (error) {
    if (id !== requestId) return;
    note(`History unavailable (${error.message})`);
  }
}

function select(nextMetric, nextRange) {
  metric = METRICS[nextMetric] ? nextMetric : 'cpu';
  range = nextRange === 'live' || state.historyAvailable ? nextRange : 'live';
  setText(byId('dlg-chart-title'), METRICS[metric].title);
  for (const b of $$('#chart-metric button')) b.setAttribute('aria-pressed', String(b.dataset.metric === metric));
  for (const b of $$('#chart-range button')) b.setAttribute('aria-pressed', String(b.dataset.range === range));
  note('');
  if (range === 'live') {
    history = null;
    draw();
  } else if (history?.range === range) {
    draw();
  } else {
    history = null;
    chart?.setData({ series: [], from: 0, to: 1 });
    note('Loading history…');
    loadHistory();
  }
}

export function openChart(nextMetric = 'cpu', nextRange = 'live') {
  openDialog('dlg-chart');
  chart ||= createChart(byId('chart-large'), { axis: true });
  select(nextMetric, nextRange);
}

export function initChartModal() {
  byId('chart-metric').addEventListener('click', (event) => {
    const button = event.target.closest('[data-metric]');
    if (button) select(button.dataset.metric, range);
  });
  byId('chart-range').addEventListener('click', (event) => {
    const button = event.target.closest('[data-range]');
    if (button) select(metric, button.dataset.range);
  });
  on('history-available', (available) => {
    for (const b of $$('#chart-range [data-range]:not([data-range="live"])')) b.hidden = !available;
    show(byId('chart-range'), Boolean(available));
  });
  on('stats', () => {
    if (!isOpen()) return;
    if (range === 'live') draw();
    else if (Date.now() - historyAt > HISTORY_REFRESH_MS) loadHistory();
  });

  // Any metric panel opens its chart, unless the click hit a control or a text selection.
  document.addEventListener('click', (event) => {
    const panel = event.target.closest('.metric[data-chart]');
    if (!panel) return;
    const control = event.target.closest('button, a, input, table');
    if (control && !control.matches('[data-open-chart]')) return;
    if (String(window.getSelection())) return;
    openChart(panel.dataset.chart);
  });
}
