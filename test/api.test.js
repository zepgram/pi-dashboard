import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../server/app.js';
import { Collector } from '../server/collector/index.js';
import { loadConfig } from '../server/config.js';
import { SettingsStore } from '../server/settings.js';

function start(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pidash-api-'));
  const config = loadConfig({ SETTINGS_CONFIG: path.join(dir, 'settings.json'), CORS_ORIGINS: '*', ...env });
  const collector = new Collector(config);
  const store = new SettingsStore(config.settingsPath);
  collector.start();
  return new Promise(resolve => {
    const server = createApp({ config, store, collector }).listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      const call = async (method, url, body, headers = {}) => {
        const res = await fetch(base + url, {
          method,
          headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
          body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let data = text;
        try {
          data = JSON.parse(text);
        } catch {
          // not JSON
        }
        return { status: res.status, data, headers: res.headers };
      };
      resolve({ call, store, file: config.settingsPath, close: () => (collector.stop(), new Promise(done => server.close(done))) });
    });
  });
}

describe('dashboard API', () => {
  let app;
  before(async () => (app = await start()));
  after(() => app.close());

  test('health reports the version', async () => {
    const { status, data } = await app.call('GET', '/api/health');
    assert.equal(status, 200);
    assert.equal(data.status, 'ok');
    assert.match(data.version, /^\d+\.\d+\.\d+/);
  });

  test('stats keeps the 1.0 shape', async () => {
    const { status, data } = await app.call('GET', '/api/stats');
    assert.equal(status, 200);
    for (const key of ['cpu', 'memory', 'temperature', 'load', 'os', 'disks', 'containers', 'network', 'processes']) {
      assert.ok(key in data, `missing ${key}`);
    }
    assert.ok(data.cpu.usage >= 0 && data.cpu.usage <= 100);
    assert.equal(data.cpu.cores.length, os.cpus().length);
    for (const key of ['total', 'used', 'buffcache', 'free', 'percent', 'usedPercent', 'buffcachePercent']) {
      assert.equal(typeof data.memory[key], 'number', `memory.${key}`);
    }
    assert.ok(data.memory.used <= data.memory.total);
    assert.equal(data.load.loadAvg.length, 3);
    assert.ok(Array.isArray(data.network.interfaces) && Array.isArray(data.network.stats));
    assert.equal(typeof data.temperature.throttled, 'boolean');
    assert.equal(typeof data.os.hostname, 'string');
  });

  test('history: default range, explicit range, bad range', async () => {
    const hour = (await app.call('GET', '/api/history')).data;
    assert.equal(hour.range, '1h');
    assert.equal(hour.series.cpu.length, 720);
    assert.equal((await app.call('GET', '/api/history?range=24h')).data.series.rx.length, 1440);
    assert.equal((await app.call('GET', '/api/history?range=7d')).status, 400);
    assert.equal((await app.call('GET', '/api/history?range=__proto__')).status, 400);
  });

  test('settings round trip, with unknown keys kept and junk refused', async () => {
    const saved = await app.call('PUT', '/api/settings', { theme: 'rose', displayMode: 'compact', thresholds: { disk: { warning: 80, critical: 95 } }, evil: { a: 1 } });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.theme, 'rose');
    assert.equal(saved.data.displayMode, 'compact');
    assert.equal(saved.data.evil, undefined);
    assert.deepEqual(saved.data.thresholds.disk, { warning: 80, critical: 95 });
    assert.deepEqual(saved.data.thresholds.cpu, { warning: 70, critical: 90 });
    assert.equal((await app.call('GET', '/api/settings')).data.theme, 'rose');
  });

  test('services config: add, replace, delete, validate', async () => {
    const added = await app.call('POST', '/api/services/config', { name: 'SSH', port: 22 });
    assert.equal(added.data.services.length, 1);
    assert.equal(added.data.services[0].checkType, 'tcp');
    assert.equal((await app.call('POST', '/api/services/config', { port: 22 })).status, 400);
    assert.equal((await app.call('PUT', '/api/services/config', { services: 'x' })).status, 400);
    const replaced = await app.call('PUT', '/api/services/config', { services: [{ name: 'A', port: 1 }, { name: 'B', port: 2, enabled: false }] });
    assert.equal(replaced.data.services.length, 2);
    assert.equal((await app.call('DELETE', '/api/services/config/7')).status, 404);
    assert.equal((await app.call('DELETE', '/api/services/config/x')).status, 400);
    assert.equal((await app.call('DELETE', '/api/services/config/0')).data.services[0].name, 'B');
    const config = (await app.call('GET', '/api/services/config')).data;
    assert.equal(config.requiresAuth, false);
    // Disabled services are configured but not checked.
    assert.deepEqual((await app.call('GET', '/api/services')).data, []);
  });

  test('a service nobody listens on is reported offline', async () => {
    await app.call('PUT', '/api/services/config', { services: [{ name: 'closed', port: 1, checkType: 'tcp' }] });
    const [closed] = (await app.call('GET', '/api/services')).data;
    assert.equal(closed.status, 'offline');
    assert.equal(closed.latency, null);
  });

  test('wireguard is off by default', async () => {
    assert.equal((await app.call('GET', '/api/wireguard')).status, 503);
    const saved = await app.call('PUT', '/api/settings/wireguard', { enabled: false, interface: '../etc' });
    assert.equal(saved.data.interface, 'wg0');
    assert.equal((await app.call('PUT', '/api/settings/wireguard', { interface: 'wg1' })).data.interface, 'wg1');
  });

  test('unknown API routes answer 404 in JSON', async () => {
    const res = await app.call('GET', '/api/nope');
    assert.equal(res.status, 404);
    assert.deepEqual(res.data, { error: 'Not found' });
  });
});

describe('external API and MCP', () => {
  let app;
  let key;
  before(async () => (app = await start()));
  after(() => app.close());

  const rpc = (method, params, headers) =>
    app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method, params }, { Accept: 'application/json, text/event-stream', ...headers });
  const parseRpc = data => (typeof data === 'string' ? JSON.parse(data.split('\n').find(l => l.startsWith('data:')).slice(5)) : data);

  test('closed until enabled', async () => {
    assert.equal((await app.call('GET', '/api/v1/system')).status, 403);
    assert.equal((await rpc('tools/list', {})).status, 403);
    assert.deepEqual((await app.call('GET', '/api/settings/api')).data, { enabled: false, hasKey: false, mcp: { path: '/mcp' } });
  });

  test('key is returned once and only its hash is stored', async () => {
    const res = await app.call('PUT', '/api/settings/api', { enabled: true, generateKey: true });
    key = res.data.key;
    assert.equal(res.data.hasKey, true);
    assert.match(key, /^[\w-]{32}$/);
    const onDisk = JSON.parse(fs.readFileSync(app.file, 'utf-8'));
    assert.equal(onDisk.api.key, undefined);
    assert.match(onDisk.api.keyHash, /^[0-9a-f]{64}$/);
    assert.equal((await app.call('PUT', '/api/settings/api', { enabled: true })).data.key, null);
  });

  test('v1 accepts the key by header, bearer or query, and nothing else', async () => {
    assert.equal((await app.call('GET', '/api/v1/system')).status, 401);
    assert.equal((await app.call('GET', '/api/v1/system', null, { 'X-API-Key': 'wrong' })).status, 401);
    const byHeader = await app.call('GET', '/api/v1/system', null, { 'X-API-Key': key });
    assert.equal(byHeader.status, 200);
    for (const field of ['timestamp', 'system', 'cpu', 'memory', 'temperature', 'load', 'os', 'disks', 'network', 'containers', 'processes', 'baseboard', 'services']) {
      assert.ok(field in byHeader.data, `missing ${field}`);
    }
    assert.equal((await app.call('GET', '/api/v1/system', null, { Authorization: `Bearer ${key}` })).status, 200);
    assert.equal((await app.call('GET', `/api/v1/system?key=${key}`)).status, 200);
    assert.equal((await app.call('GET', '/api/v1/history?range=24h', null, { 'X-API-Key': key })).data.step, 60);
  });

  test('MCP: initialize, list tools, call tools', async () => {
    const auth = { Authorization: `Bearer ${key}` };
    assert.equal((await rpc('tools/list', {})).status, 401);

    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } }, auth);
    assert.equal(init.status, 200);
    assert.equal(parseRpc(init.data).result.serverInfo.name, 'pi-dashboard');

    const tools = parseRpc((await rpc('tools/list', {}, auth)).data).result.tools;
    assert.deepEqual(tools.map(t => t.name).sort(), [
      'get_history',
      'get_services_status',
      'get_system_info',
      'get_system_overview',
      'get_top_processes',
      'get_wireguard_clients',
      'list_containers',
    ]);
    assert.ok(tools.every(t => t.annotations?.readOnlyHint === true));

    const overview = parseRpc((await rpc('tools/call', { name: 'get_system_overview', arguments: {} }, auth)).data).result;
    const body = JSON.parse(overview.content[0].text);
    assert.equal(typeof body.host, 'string');
    assert.ok(body.cpu.usagePercent >= 0);
    assert.ok(Array.isArray(body.alerts));

    const history = parseRpc((await rpc('tools/call', { name: 'get_history', arguments: { metric: 'cpu', max_points: 5 } }, auth)).data).result;
    assert.equal(JSON.parse(history.content[0].text).metric, 'cpu');

    const bad = parseRpc((await rpc('tools/call', { name: 'get_history', arguments: { metric: 'nope' } }, auth)).data);
    assert.ok(bad.error || bad.result.isError);

    assert.equal((await app.call('GET', '/mcp', null, auth)).status, 405);
  });

  test('clearing the key opens the enabled API, disabling closes it', async () => {
    await app.call('PUT', '/api/settings/api', { clearKey: true });
    assert.equal((await app.call('GET', '/api/v1/system')).status, 200);
    await app.call('PUT', '/api/settings/api', { enabled: false });
    assert.equal((await app.call('GET', '/api/v1/system')).status, 403);
  });
});

describe('admin token', () => {
  let app;
  before(async () => (app = await start({ ADMIN_TOKEN: 's3cret' })));
  after(() => app.close());

  test('reads stay open, writes need the token', async () => {
    assert.equal((await app.call('GET', '/api/settings')).status, 200);
    assert.equal((await app.call('GET', '/api/services/config')).data.requiresAuth, true);
    assert.equal((await app.call('PUT', '/api/settings', { theme: 'rose' })).status, 401);
    assert.equal((await app.call('PUT', '/api/settings', { theme: 'rose' }, { 'X-Admin-Token': 'nope' })).status, 401);
    assert.equal((await app.call('PUT', '/api/settings', { theme: 'rose' }, { 'X-Admin-Token': 's3cret' })).status, 200);
    assert.equal((await app.call('POST', '/api/services/config', { name: 'x', port: 1 })).status, 401);
    assert.equal((await app.call('PUT', '/api/settings/api', { enabled: true })).status, 401);
    assert.equal((await app.call('GET', '/api/wireguard')).status, 401);
  });
});
