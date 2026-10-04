import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { after, before, describe, test } from 'node:test';
import { checkService } from '../server/checks.js';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

describe('service checks', () => {
  let web;
  let redis;
  let ports;
  before(async () => {
    web = http.createServer((req, res) => {
      res.statusCode = req.url === '/boom' ? 503 : req.url === '/private' ? 403 : 200;
      res.end();
    });
    redis = net.createServer(socket => socket.on('data', data => socket.write(data.toString().startsWith('PING') ? '+PONG\r\n' : '-ERR\r\n')));
    ports = { web: await listen(web), redis: await listen(redis) };
  });
  after(() => {
    web.close();
    redis.close();
  });

  const svc = extra => ({ name: 't', host: '127.0.0.1', ...extra });

  test('http: any answer below 500 is online', async () => {
    const ok = await checkService(svc({ port: ports.web, checkType: 'http', path: '/' }));
    assert.equal(ok.status, 'online');
    assert.equal(ok.statusCode, 200);
    assert.equal(typeof ok.latency, 'number');
    assert.equal((await checkService(svc({ port: ports.web, checkType: 'http', path: '/private' }))).status, 'online');
    assert.equal((await checkService(svc({ port: ports.web, checkType: 'http', path: '/boom' }))).status, 'error');
  });

  test('tcp and redis', async () => {
    assert.equal((await checkService(svc({ port: ports.web, checkType: 'tcp' }))).status, 'online');
    assert.equal((await checkService(svc({ port: ports.redis, checkType: 'redis' }))).status, 'online');
    // Something listens but does not speak Redis.
    assert.equal((await checkService(svc({ port: ports.web, checkType: 'redis' }))).status, 'error');
  });

  test('nothing listening is offline with no latency', async () => {
    for (const checkType of ['http', 'https', 'tcp', 'redis']) {
      const result = await checkService(svc({ port: 1, checkType }));
      assert.equal(result.status, 'offline', checkType);
      assert.equal(result.latency, null);
    }
  });

  test('https: a listener that does not complete TLS still counts as up', async () => {
    const result = await checkService(svc({ port: ports.redis, checkType: 'https', path: '/' }));
    assert.equal(result.status, 'online');
  });

  test('interface: present under /sys/class/net or not', async () => {
    assert.equal((await checkService(svc({ port: 1, checkType: 'interface', interface: 'lo' }))).status, 'online');
    assert.equal((await checkService(svc({ port: 1, checkType: 'interface', interface: 'nope0' }))).status, 'offline');
  });
});
