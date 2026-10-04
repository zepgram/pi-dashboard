import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { IFACE_NAME, KNOWN_SERVICES } from './services-config.js';

const TIMEOUT_MS = 3000;
const TLS_PORTS = new Set([443, 8443]);

const offline = service => ({ ...service, status: 'offline', latency: null });

function checkHttp(service, tls) {
  return new Promise(resolve => {
    const start = Date.now();
    const client = tls ? https : http;
    const req = client.request(
      {
        hostname: service.host || 'localhost',
        port: service.port,
        path: service.path || '/',
        method: 'HEAD',
        timeout: TIMEOUT_MS,
        // Health check only: self-signed certificates on a home server are the norm.
        rejectUnauthorized: false,
      },
      res => {
        res.resume();
        resolve({
          ...service,
          status: res.statusCode < 500 ? 'online' : 'error',
          latency: Date.now() - start,
          statusCode: res.statusCode,
        });
      },
    );
    // A server that accepts the connection but refuses the TLS handshake (unknown SNI,
    // client certificate required) is up: only a failed connection means offline.
    let connectedAt = null;
    req.on('socket', socket => socket.once('connect', () => (connectedAt = Date.now())));
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', error => {
      if (tls && connectedAt && error.message !== 'timeout') {
        return resolve({ ...service, status: 'online', latency: connectedAt - start });
      }
      resolve(offline(service));
    });
    req.end();
  });
}

function checkTcp(service, probe) {
  return new Promise(resolve => {
    const start = Date.now();
    const socket = net.connect({ port: service.port, host: service.host || 'localhost' });
    const done = result => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(TIMEOUT_MS, () => done(offline(service)));
    socket.on('error', () => done(offline(service)));
    socket.on('connect', () => {
      if (!probe) return done({ ...service, status: 'online', latency: Date.now() - start });
      socket.write(probe.send);
    });
    socket.on('data', data => {
      done({
        ...service,
        status: data.toString().includes(probe.expect) ? 'online' : 'error',
        latency: Date.now() - start,
      });
    });
  });
}

function checkDns(service) {
  return new Promise(resolve => {
    const start = Date.now();
    const host = !service.host || service.host === 'localhost' ? '127.0.0.1' : service.host;
    const resolver = new dns.Resolver({ timeout: TIMEOUT_MS, tries: 1 });
    try {
      resolver.setServers([`${host}:${service.port || 53}`]);
    } catch {
      return resolve(offline(service));
    }
    resolver.resolve4('example.com', err => {
      // Any answer from the server, even NXDOMAIN, proves it is up.
      const answered = !err || ['ENOTFOUND', 'ENODATA', 'ESERVFAIL', 'EREFUSED'].includes(err.code);
      resolve(answered ? { ...service, status: 'online', latency: Date.now() - start } : offline(service));
    });
  });
}

export function interfaceFor(service) {
  const candidates = [service.interface, service.path, KNOWN_SERVICES[service.port]?.interface, 'wg0'];
  return candidates.find(name => typeof name === 'string' && IFACE_NAME.test(name));
}

function checkInterface(service, sysRoot) {
  return new Promise(resolve => {
    const start = Date.now();
    fs.access(`${sysRoot}/class/net/${interfaceFor(service)}`, err => {
      resolve(err ? offline(service) : { ...service, status: 'online', latency: Date.now() - start });
    });
  });
}

export function checkService(service, { sysRoot = '/sys' } = {}) {
  switch (service.checkType) {
    case 'tcp':
      return checkTcp(service);
    case 'redis':
      return checkTcp(service, { send: 'PING\r\n', expect: 'PONG' });
    case 'dns':
      return checkDns(service);
    case 'interface':
      return checkInterface(service, sysRoot);
    case 'https':
      return checkHttp(service, true);
    case 'http':
    default:
      return checkHttp(service, TLS_PORTS.has(service.port));
  }
}
