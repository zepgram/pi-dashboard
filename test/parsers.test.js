import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interfaceFor } from '../server/checks.js';
import { parseMounts } from '../server/collector/disks.js';
import { parseHealth } from '../server/collector/docker.js';
import { decodeThrottle, parseMeminfo, parseOsRelease } from '../server/collector/host.js';
import { formatElapsed, parseProcStat } from '../server/collector/processes.js';
import { parseListeningTcp, parseListeningUdp } from '../server/discovery.js';
import { formatTimeAgo, parseClientNames, parseHandshakeTime, parseWgShow } from '../server/wireguard.js';

test('meminfo: used is total minus available, cache is reported apart', () => {
  const mem = parseMeminfo(
    ['MemTotal: 16000000 kB', 'MemFree: 1000000 kB', 'MemAvailable: 9000000 kB', 'Buffers: 500000 kB', 'Cached: 7000000 kB', 'SReclaimable: 500000 kB'].join('\n'),
  );
  assert.equal(mem.total, 16000000 * 1024);
  assert.equal(mem.used, 7000000 * 1024);
  assert.equal(mem.free, 9000000 * 1024);
  assert.equal(mem.buffcache, 8000000 * 1024);
  assert.equal(mem.percent, 43.8);
  assert.equal(mem.buffcachePercent, 50);
});

test('meminfo: empty input does not divide by zero', () => {
  assert.deepEqual(parseMeminfo(''), { total: 0, used: 0, buffcache: 0, free: 0, percent: 0, usedPercent: 0, buffcachePercent: 0 });
});

test('throttle word: live bits throttle, history bits only explain', () => {
  assert.deepEqual(decodeThrottle(0), { throttled: false, flags: 0, reasons: [] });
  const past = decodeThrottle(0x50000);
  assert.equal(past.throttled, false);
  assert.deepEqual(past.reasons, ['Under-voltage occurred', 'Throttling occurred']);
  const live = decodeThrottle(0x50005);
  assert.equal(live.throttled, true);
  assert.deepEqual(live.reasons.slice(0, 2), ['Under-voltage', 'Throttled']);
});

test('mounts: block devices only, first mount per device, no boot or loop', () => {
  const table = [
    'sysfs /sys sysfs rw 0 0',
    '/dev/mmcblk0p2 / ext4 rw 0 0',
    '/dev/mmcblk0p1 /boot/firmware vfat rw 0 0',
    '/dev/loop3 /snap/core squashfs ro 0 0',
    '/dev/nvme0n1p1 /media/ssd ext4 rw 0 0',
    '/dev/nvme0n1p1 /var/lib/docker/volumes/x ext4 rw 0 0',
    '/dev/sda1 /mnt/My\\040Disk exfat rw 0 0',
  ].join('\n');
  assert.deepEqual(parseMounts(table), [
    { fs: '/dev/mmcblk0p2', mount: '/' },
    { fs: '/dev/nvme0n1p1', mount: '/media/ssd' },
    { fs: '/dev/sda1', mount: '/mnt/My Disk' },
  ]);
});

test('container health comes from the status text', () => {
  assert.equal(parseHealth('Up 3 hours (healthy)'), 'healthy');
  assert.equal(parseHealth('Up 2 minutes (unhealthy)'), 'unhealthy');
  assert.equal(parseHealth('Up 5 seconds (health: starting)'), 'starting');
  assert.equal(parseHealth('Up 3 hours'), null);
  assert.equal(parseHealth('Exited (0) 2 days ago'), null);
});

test('proc stat: command names with spaces and parentheses', () => {
  const fields = Array.from({ length: 50 }, (_, i) => String(i));
  fields[0] = 'S';
  fields[11] = '150';
  fields[12] = '50';
  fields[19] = '4200';
  const parsed = parseProcStat(`1234 (tmux: server (1)) ${fields.join(' ')}`);
  assert.deepEqual(parsed, { name: 'tmux: server (1)', state: 'S', ticks: 200, startTicks: 4200 });
  assert.equal(parseProcStat('garbage'), null);
});

test('elapsed time follows ps etime', () => {
  assert.equal(formatElapsed(59), '00:59');
  assert.equal(formatElapsed(3661), '01:01:01');
  assert.equal(formatElapsed(2 * 86400 + 3600 + 5), '2-01:00:05');
  assert.equal(formatElapsed(-4), '00:00');
});

test('os-release values lose their quotes', () => {
  const info = parseOsRelease('PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nVERSION_ID="12"\nID=debian\n');
  assert.equal(info.PRETTY_NAME, 'Debian GNU/Linux 12 (bookworm)');
  assert.equal(info.VERSION_ID, '12');
  assert.equal(info.ID, 'debian');
});

const WG_SHOW = `interface: wg0
  public key: SERVERKEYSERVERKEYSERVERKEYSERVERKEYSERVER0=
  private key: (hidden)
  listening port: 51820

peer: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
  endpoint: 203.0.113.7:51111
  allowed ips: 10.6.0.2/32
  latest handshake: 1 minute, 12 seconds ago
  transfer: 3.65 MiB received, 1.50 GiB sent

peer: BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=
  allowed ips: 10.6.0.3/32
`;

test('wg show: interface, peers, handshake and transfer', () => {
  const data = parseWgShow(WG_SHOW, 'wg0');
  assert.equal(data.interface.listenPort, 51820);
  assert.equal(data.interface.publicKey, 'SERVERKEYSERVERKEYSERVERKEYSERVERKEYSERVER0=');
  assert.equal(data.peers.length, 2);
  const [phone, idle] = data.peers;
  assert.equal(phone.endpoint, '203.0.113.7:51111');
  assert.equal(phone.lastHandshakeSeconds, 72);
  assert.deepEqual(phone.transfer, { received: Math.round(3.65 * 1024 ** 2), sent: Math.round(1.5 * 1024 ** 3) });
  assert.equal(idle.lastHandshakeSeconds, null);
  assert.deepEqual(idle.transfer, { received: 0, sent: 0 });
});

test('handshake durations and relative times', () => {
  assert.equal(parseHandshakeTime('2 hours, 3 minutes, 4 seconds ago'), 7384);
  assert.equal(parseHandshakeTime('1 day ago'), 86400);
  assert.equal(parseHandshakeTime(''), null);
  assert.equal(formatTimeAgo(null), 'never');
  assert.equal(formatTimeAgo(45), '45 sec ago');
  assert.equal(formatTimeAgo(7200), '2 hr ago');
});

test('client names from pivpn -l and clients.txt', () => {
  const key = 'Tw5JUD0NvrGO+OxN+rE3HYdOqa/AYB5swNwQtOGjxl0=';
  const pivpn = `::: Clients Summary :::\nClient      Public key                                        Creation date\nphone       ${key}      07 Jan 2025, 21:14\n`;
  assert.deepEqual([...parseClientNames(pivpn)], [[key, 'phone']]);
  assert.deepEqual([...parseClientNames(`laptop ${key} 1736280859 3\n`)], [[key, 'laptop']]);
});

test('discovery: public listeners only, known ports named, high ports dropped', () => {
  const ss = [
    'State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
    'LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1,fd=3))',
    'LISTEN 0 128 127.0.0.1:5432 0.0.0.0:* users:(("postgres",pid=2,fd=3))',
    'LISTEN 0 128 *:8096 *:* users:(("jellyfin",pid=3,fd=3))',
    'LISTEN 0 128 [::]:22 [::]:* users:(("sshd",pid=1,fd=4))',
    'LISTEN 0 128 0.0.0.0:4321 0.0.0.0:* users:(("myapp",pid=4,fd=3))',
    'LISTEN 0 128 0.0.0.0:45000 0.0.0.0:* users:(("rpc.statd",pid=5,fd=3))',
    'LISTEN 0 511 192.168.1.5:443 0.0.0.0:* users:(("nginx",pid=6,fd=3))',
    'LISTEN 0 128 [::1]:631 [::]:* users:(("cupsd",pid=7,fd=3))',
    'LISTEN 0 128 127.0.0.53%lo:53 0.0.0.0:* users:(("systemd-resolve",pid=8,fd=3))',
  ].join('\n');
  const { discovered } = parseListeningTcp(ss);
  assert.deepEqual(discovered.map(s => [s.port, s.name, s.checkType, s.host]), [
    [22, 'SSH', 'tcp', 'localhost'],
    [8096, 'Jellyfin', 'http', 'localhost'],
    [4321, 'myapp', 'tcp', 'localhost'],
    [443, 'Nginx', 'http', '192.168.1.5'],
  ]);
  const netstat = 'tcp        0      0 :::8123                 :::*                    LISTEN      42/python3';
  assert.deepEqual(parseListeningTcp(netstat).discovered.map(s => [s.port, s.name]), [[8123, 'Home Assistant']]);
});

test('discovery: only known VPN ports are taken from UDP', () => {
  const ss = 'UNCONN 0 0 0.0.0.0:51820 0.0.0.0:*\nUNCONN 0 0 0.0.0.0:5353 0.0.0.0:* users:(("avahi",pid=1,fd=3))\n';
  const found = parseListeningUdp(ss);
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].name, found[0].checkType, found[0].interface], ['WireGuard', 'interface', 'wg0']);
});

test('interface check never leaves /sys/class/net', () => {
  assert.equal(interfaceFor({ interface: 'tun0', path: '/', port: 1 }), 'tun0');
  assert.equal(interfaceFor({ path: 'wg1', port: 1 }), 'wg1');
  // Saved through the editor, the path defaults to "/": fall back to the port's usual interface.
  assert.equal(interfaceFor({ path: '/', port: 51820 }), 'wg0');
  assert.equal(interfaceFor({ interface: '../../etc', path: '..', port: 1194 }), 'tun0');
});
