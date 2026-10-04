import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { History, METRICS } from '../server/history.js';
import { activeAlerts, summarizeSeries } from '../server/mcp.js';

const sample = cpu => ({ cpu, memory: 40, temperature: 50, load: 1, rx: 100, tx: 200 });

test('samples of one bucket are averaged, missing buckets stay null', () => {
  const history = new History();
  const t0 = 1_700_000_000_000;
  history.record(sample(10), t0);
  history.record(sample(30), t0 + 2000);
  history.record(sample(50), t0 + 15_000);

  const hour = history.get('1h', t0 + 15_000);
  assert.equal(hour.step, 5);
  assert.equal(hour.series.cpu.length, 720);
  assert.equal(hour.to - hour.from, 719 * 5000);
  assert.deepEqual(hour.series.cpu.slice(-4), [20, null, null, 50]);
  for (const metric of METRICS) assert.equal(hour.series[metric].length, 720);

  const day = history.get('24h', t0 + 15_000);
  assert.equal(day.step, 60);
  assert.equal(day.series.cpu.at(-1), 30);
  assert.equal(history.get('7d'), null);
});

test('old buckets are evicted', () => {
  const history = new History();
  const t0 = 1_700_000_000_000;
  history.record(sample(10), t0);
  history.record(sample(20), t0 + 2 * 3600_000);
  const hour = history.get('1h', t0 + 2 * 3600_000);
  assert.equal(hour.series.cpu.filter(v => v !== null).length, 1);
});

test('history survives a restart through its dump file', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pidash-')), 'history.json');
  const t0 = 1_700_000_000_000;
  const before = new History();
  before.record(sample(42), t0);
  before.save(file);
  const after = new History();
  assert.equal(after.load(file), true);
  assert.equal(after.get('1h', t0).series.cpu.at(-1), 42);
  assert.equal(new History().load(path.join(os.tmpdir(), 'pidash-missing.json')), false);
});

test('series summary: stats and downsampling', () => {
  const history = new History();
  const t0 = 1_700_000_000_000;
  for (let i = 0; i < 12; i++) history.record(sample(i * 10), t0 + i * 5000);
  const summary = summarizeSeries(history.get('1h', t0 + 55_000), 'cpu', 60);
  assert.equal(summary.min, 0);
  assert.equal(summary.max, 110);
  assert.equal(summary.avg, 55);
  assert.equal(summary.last, 110);
  assert.equal(summary.resolutionSeconds, 60);
  assert.equal(summary.points.length, 1);
  assert.deepEqual(summarizeSeries(new History().get('1h', t0), 'cpu', 60).points, []);
});

test('alerts follow the dashboard thresholds', () => {
  const stats = {
    cpu: { usage: 95 },
    memory: { percent: 82 },
    temperature: { main: 40, throttled: true, reasons: ['Under-voltage'] },
    disks: [{ mount: '/', percent: 50 }, { mount: '/data', percent: 97 }],
    containers: [{ name: 'db', health: 'unhealthy' }, { name: 'web', health: 'healthy' }],
  };
  const thresholds = { cpu: { warning: 70, critical: 90 }, memory: { warning: 80, critical: 95 }, temperature: { warning: 65, critical: 80 }, disk: { warning: 80, critical: 95 } };
  assert.deepEqual(
    activeAlerts(stats, thresholds).map(a => [a.level, a.metric]),
    [['critical', 'cpu'], ['warning', 'memory'], ['critical', 'disk /data'], ['critical', 'throttling'], ['critical', 'container db']],
  );
});
