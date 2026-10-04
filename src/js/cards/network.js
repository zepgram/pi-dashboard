import { byId, el, setText, show, syncList } from '../dom.js';
import { on } from '../bus.js';
import { bytes, rate } from '../format.js';
import { liveChart } from './metric.js';

const TYPE_LABEL = { wired: 'ETH', wireless: 'WLAN', vpn: 'VPN' };

export function initNetwork() {
  const body = byId('net-ifaces');
  const draw = liveChart('chart-network', { min: 0, max: null, minMax: 1024, base: 1024 });

  on('stats', (stats) => {
    const interfaces = stats.network?.interfaces || [];
    const byName = new Map((stats.network?.stats || []).map((s) => [s.iface, s]));

    setText(byId('net-rx'), rate(stats._net.rx));
    setText(byId('net-tx'), rate(stats._net.tx));
    show(byId('net-empty'), interfaces.length === 0);
    show(body.closest('.table-wrap'), interfaces.length > 0);
    const count = byId('net-count');
    show(count, interfaces.length > 0);
    setText(count, `${interfaces.length} ${interfaces.length === 1 ? 'interface' : 'interfaces'}`);

    syncList(
      body,
      interfaces,
      (iface) => iface.name,
      () =>
        el(
          'tr',
          {},
          el('td', {}, el('span', { class: 'cell-main' }), el('span', { class: 'chip' })),
          el('td', { class: 'mono dim' }),
          el('td', { class: 'r mono rx' }),
          el('td', { class: 'r mono tx' }),
          el('td', { class: 'r mono dim col-total' })
        ),
      (row, iface) => {
        const s = byName.get(iface.name) || {};
        const [name, address, rx, tx, total] = row.children;
        setText(name.firstChild, iface.name);
        setText(name.lastChild, TYPE_LABEL[iface.type] || '');
        show(name.lastChild, Boolean(TYPE_LABEL[iface.type]));
        setText(address, iface.ip4 || '--');
        setText(rx, rate(s.rxSec ?? 0));
        setText(tx, rate(s.txSec ?? 0));
        setText(total, `${bytes(s.rxBytes ?? 0)} / ${bytes(s.txBytes ?? 0)}`);
      }
    );

    draw(
      [
        { key: 'rx', color: '--accent' },
        { key: 'tx', color: '--accent-2' }
      ],
      stats._time
    );
  });
}
