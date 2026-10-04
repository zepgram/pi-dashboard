import { byId, el, setAttr, setText, show, syncList } from '../dom.js';
import { on } from '../bus.js';
import { isNum } from '../format.js';

const STATE_TEXT = { online: 'online', offline: 'offline', error: 'error' };

export function initServices() {
  const host = byId('services');
  const empty = byId('services-empty');
  const count = byId('services-count');

  on('services', (services) => {
    show(empty, services.length === 0);
    setText(empty, 'No services configured');
    const online = services.filter((s) => s.status === 'online').length;
    show(count, services.length > 0);
    setText(count, `${online}/${services.length} online`);
    setAttr(count, 'data-level', online === services.length ? 'ok' : 'warn');

    syncList(
      host,
      services,
      (s, i) => `${i}|${s.host}|${s.port}`,
      () =>
        el(
          'div',
          { class: 'svc' },
          el('span', { class: 'lamp', 'aria-hidden': 'true' }),
          el('span', { class: 'svc-name' }),
          el('span', { class: 'svc-port' }),
          el('span', { class: 'svc-lat' })
        ),
      (row, s) => {
        const status = STATE_TEXT[s.status] || 'offline';
        const [, name, port, latency] = row.children;
        setAttr(row, 'data-state', status);
        setText(name, s.name);
        setAttr(name, 'title', `${s.name} (${s.host || 'localhost'}:${s.port})`);
        setText(port, `:${s.port}`);
        setText(latency, status === 'online' && isNum(s.latency) ? `${s.latency} ms` : status);
      }
    );
  });

  on('services-error', () => {
    if (host.children.length) return;
    show(empty, true);
    setText(empty, 'Service checks unavailable');
  });
}
