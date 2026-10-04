// Shared helpers for the metric panels (live chart + min/avg/max readout).
import { $ } from '../dom.js';
import { createChart } from '../charts.js';
import { live, LIVE_WINDOW_MS, summarize } from '../series.js';
import { state } from '../state.js';
import { setText } from '../dom.js';

export const liveGap = () => Math.max(5000, state.settings.interval * 4000);

export function thresholdLines(key) {
  const t = state.settings.thresholds[key];
  if (!t) return [];
  return [
    { value: t.warning, color: '--warn' },
    { value: t.critical, color: '--crit' }
  ];
}

export function liveChart(canvasId, options) {
  const chart = createChart(document.getElementById(canvasId), options);
  return (series, now, thresholds = []) => {
    chart.setData({
      series: series.map((s) => ({ ...live[s.key], color: s.color, fill: s.fill })),
      from: now - LIVE_WINDOW_MS,
      to: now,
      thresholds,
      gap: liveGap()
    });
  };
}

export function readout(root, key, now, format) {
  const summary = summarize(live[key], now - LIVE_WINDOW_MS, now);
  for (const name of ['min', 'avg', 'max']) {
    setText($(`[data-r="${name}"]`, root), summary ? format(summary[name]) : '--');
  }
}
