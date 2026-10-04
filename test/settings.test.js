import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { SettingsStore, sanitizeDashboardPatch, validateService } from '../server/settings.js';

const limits = { maxServices: 50, maxNameLength: 100, maxPathLength: 200 };
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pidash-')), 'settings.json');

test('dashboard patch: known keys are typed, junk is dropped, extras survive', () => {
  const patch = sanitizeDashboardPatch(
    JSON.parse(
      '{"theme":"rose","interval":"0","sound":false,"displayMode":"ultra","overclockBase":2.8,' +
        '"thresholds":{"cpu":{"warning":60,"critical":85},"disk":{"warning":"x","critical":95}},' +
        '"__proto__":{"polluted":true},"nested":{"a":1},"list":[1]}',
    ),
  );
  assert.deepEqual(patch, {
    theme: 'rose',
    interval: 1,
    sound: false,
    displayMode: 'ultra',
    overclockBase: 2.8,
    thresholds: { cpu: { warning: 60, critical: 85 } },
  });
  assert.equal({}.polluted, undefined);
  assert.deepEqual(sanitizeDashboardPatch('nope'), {});
  assert.deepEqual(sanitizeDashboardPatch({ theme: '<script>' }), {});
});

test('service validation: required fields, inference, sanitizing', () => {
  assert.equal(validateService({ port: 80 }, limits).valid, false);
  assert.equal(validateService({ name: 'x', port: 70000 }, limits).valid, false);
  assert.equal(validateService({ name: 'x', port: 80, checkType: 'ftp' }, limits).valid, false);
  assert.equal(validateService(null, limits).valid, false);

  const { sanitized } = validateService({ name: ' <b>Redis</b> ', port: '6379' }, limits);
  assert.deepEqual(sanitized, { name: 'Redis', port: 6379, path: '/', host: 'localhost', checkType: 'redis', icon: 'database', enabled: true });

  const vpn = validateService({ name: 'VPN', port: 51820, checkType: 'interface', interface: 'wg1', enabled: false }, limits).sanitized;
  assert.equal(vpn.interface, 'wg1');
  assert.equal(vpn.enabled, false);
  assert.equal(validateService({ name: 'VPN', port: 51820, interface: '../x' }, limits).sanitized.interface, undefined);
});

test('store: defaults without a file, file created on first save', async () => {
  const file = tmpFile();
  const store = new SettingsStore(file);
  const fresh = await store.load();
  assert.equal(fresh.dashboard.theme, 'default');
  assert.deepEqual(fresh.services, []);
  assert.equal(fs.existsSync(file), false);

  await store.update(s => {
    s.dashboard.theme = 'amber';
  });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf-8')).dashboard.theme, 'amber');
  assert.equal((await store.load()).dashboard.theme, 'amber');
});

test('store: a 1.0 settings file keeps every key it had', async () => {
  const file = tmpFile();
  const legacy = {
    wireguard: { enabled: true, interface: 'wg0' },
    dashboard: { theme: 'indigo', interval: 2, sound: false, compact: true, displayMode: 'compact', overclockBase: 2.8, thresholds: { cpu: { warning: 50, critical: 60 } } },
    api: { enabled: true, keyHash: 'abc' },
    security: { enabled: true },
    services: [{ name: 'SSH', port: 22, checkType: 'tcp', icon: 'terminal', enabled: true }],
  };
  fs.writeFileSync(file, JSON.stringify(legacy));
  const store = new SettingsStore(file);
  const loaded = await store.load();
  assert.equal(loaded.dashboard.displayMode, 'compact');
  assert.equal(loaded.dashboard.overclockBase, 2.8);
  assert.deepEqual(loaded.dashboard.thresholds.cpu, { warning: 50, critical: 60 });
  assert.deepEqual(loaded.dashboard.thresholds.memory, { warning: 80, critical: 95 });
  assert.deepEqual(loaded.security, { enabled: true });
  assert.equal(loaded.api.keyHash, 'abc');

  await store.update(s => {
    s.dashboard.sound = true;
  });
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf-8'));
  assert.deepEqual(onDisk.security, { enabled: true });
  assert.equal(onDisk.services.length, 1);
  assert.equal(onDisk.wireguard.enabled, true);
});

test('store: concurrent updates are applied one after the other', async () => {
  const store = new SettingsStore(tmpFile());
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      store.update(s => {
        s.services.push({ name: `svc-${i}`, port: 1000 + i });
      }),
    ),
  );
  assert.equal((await store.load()).services.length, 20);
});

test('store: a hand edit on disk is picked up, a broken file falls back to defaults', async () => {
  const file = tmpFile();
  const store = new SettingsStore(file);
  await store.update(s => {
    s.dashboard.theme = 'rose';
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  fs.writeFileSync(file, JSON.stringify({ dashboard: { theme: 'emerald' } }));
  assert.equal((await store.load()).dashboard.theme, 'emerald');
  await new Promise(resolve => setTimeout(resolve, 20));
  fs.writeFileSync(file, '{ not json');
  assert.equal((await store.load()).dashboard.theme, 'default');
});
