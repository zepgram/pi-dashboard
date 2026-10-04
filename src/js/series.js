// Client-side rolling buffers behind the live charts.
export const LIVE_WINDOW_MS = 5 * 60 * 1000;
const KEEP_MS = 15 * 60 * 1000;

export const METRICS = ['cpu', 'memory', 'temperature', 'load', 'rx', 'tx'];

export const live = Object.fromEntries(METRICS.map((key) => [key, { t: [], v: [] }]));

export function push(key, time, value) {
  const s = live[key];
  if (s.t.length && time <= s.t[s.t.length - 1]) return;
  s.t.push(time);
  s.v.push(typeof value === 'number' && Number.isFinite(value) ? value : null);
  const cutoff = time - KEEP_MS;
  let drop = 0;
  while (drop < s.t.length && s.t[drop] < cutoff) drop++;
  if (drop) {
    s.t.splice(0, drop);
    s.v.splice(0, drop);
  }
}

// Seeds the buffers with server history so charts are not empty after a reload.
export function seed(history, now = Date.now()) {
  const stepMs = history.step * 1000;
  for (const key of METRICS) {
    const values = history.series?.[key];
    if (!values || live[key].t.length) continue;
    values.forEach((value, i) => {
      const time = history.from + i * stepMs;
      if (time >= now - KEEP_MS && time < now) push(key, time, value);
    });
  }
}

export function fromHistory(history, key) {
  const values = history.series?.[key] || [];
  const stepMs = history.step * 1000;
  return { t: values.map((_, i) => history.from + i * stepMs), v: values };
}

export function summarize(series, from = -Infinity, to = Infinity) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  let last = null;
  for (let i = 0; i < series.t.length; i++) {
    const value = series.v[i];
    if (value == null || series.t[i] < from || series.t[i] > to) continue;
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
    count++;
    last = value;
  }
  return count ? { min, max, avg: sum / count, last, count } : null;
}
