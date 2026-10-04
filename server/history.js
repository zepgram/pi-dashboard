import fs from 'node:fs';

export const METRICS = ['cpu', 'memory', 'temperature', 'load', 'rx', 'tx'];

export const RANGES = {
  '1h': { step: 5, points: 720 },
  '24h': { step: 60, points: 1440 },
};

/** Fixed-step series: samples are averaged into time buckets, gaps stay null. */
class Series {
  constructor({ step, points }) {
    this.stepMs = step * 1000;
    this.size = points;
    this.buckets = new Map(); // bucket index → { sum: {metric}, count }
  }

  add(at, values) {
    const index = Math.floor(at / this.stepMs);
    let bucket = this.buckets.get(index);
    if (!bucket) {
      bucket = { sum: Object.fromEntries(METRICS.map(m => [m, 0])), count: 0 };
      this.buckets.set(index, bucket);
      for (const key of this.buckets.keys()) {
        if (key > index - this.size) break;
        this.buckets.delete(key);
      }
    }
    for (const metric of METRICS) bucket.sum[metric] += Number(values[metric]) || 0;
    bucket.count += 1;
  }

  window(now) {
    const last = Math.floor(now / this.stepMs);
    const first = last - this.size + 1;
    const series = Object.fromEntries(METRICS.map(m => [m, new Array(this.size).fill(null)]));
    for (const [index, bucket] of this.buckets) {
      if (index < first || index > last) continue;
      for (const metric of METRICS) {
        series[metric][index - first] = Math.round((bucket.sum[metric] / bucket.count) * 100) / 100;
      }
    }
    return { from: first * this.stepMs, to: last * this.stepMs, series };
  }

  dump() {
    return [...this.buckets].map(([index, b]) => [index, b.count, METRICS.map(m => b.sum[m])]);
  }

  restore(rows) {
    for (const [index, count, sums] of rows) {
      this.buckets.set(index, { count, sum: Object.fromEntries(METRICS.map((m, i) => [m, sums[i] || 0])) });
    }
  }
}

export class History {
  #series = Object.fromEntries(Object.entries(RANGES).map(([range, spec]) => [range, new Series(spec)]));

  record(values, at = Date.now()) {
    for (const series of Object.values(this.#series)) series.add(at, values);
  }

  get(range, now = Date.now()) {
    const series = this.#series[range];
    if (!series) return null;
    return { range, step: RANGES[range].step, ...series.window(now) };
  }

  /** Kept across restarts: written once on shutdown, never periodically (SD cards). */
  save(file) {
    const body = { savedAt: Date.now(), series: Object.fromEntries(Object.entries(this.#series).map(([k, s]) => [k, s.dump()])) };
    fs.writeFileSync(file, JSON.stringify(body));
  }

  load(file) {
    try {
      const body = JSON.parse(fs.readFileSync(file, 'utf-8'));
      for (const [range, rows] of Object.entries(body.series || {})) this.#series[range]?.restore(rows);
      return true;
    } catch {
      return false;
    }
  }
}
