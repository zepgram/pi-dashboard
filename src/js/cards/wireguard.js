import { byId, el, setAttr, setText, show, syncList } from '../dom.js';
import { api } from '../api.js';
import { on } from '../bus.js';
import { bytes } from '../format.js';

export const wireguard = { enabled: false, interface: 'wg0' };

const card = () => byId('card-wireguard');

function message(text) {
  const empty = byId('wg-empty');
  show(empty, Boolean(text));
  setText(empty, text || '');
  show(byId('wg-clients').closest('.table-wrap'), !text);
}

function render(data) {
  const clients = Array.isArray(data.clients) ? data.clients : [];
  const iface = byId('wg-iface');
  show(iface, Boolean(data.interface?.name));
  setText(iface, data.interface?.name || '');
  const count = byId('wg-count');
  show(count, !data.error);
  setText(count, `${clients.filter((c) => c.online).length}/${clients.length} online`);

  if (data.error) return message(data.error);
  if (!clients.length) return message('No WireGuard clients configured');
  message('');

  syncList(
    byId('wg-clients'),
    clients,
    (c) => c.publicKey || c.name,
    () =>
      el(
        'tr',
        {},
        el('td', { class: 'cell-name' }, el('span', { class: 'lamp', 'aria-hidden': 'true' }), el('span', { class: 'cell-main' })),
        el('td', { class: 'mono dim col-endpoint' }),
        el('td', { class: 'mono dim' }),
        el('td', { class: 'r mono rx' }),
        el('td', { class: 'r mono tx' })
      ),
    (row, c) => {
      const [name, endpoint, seen, rx, tx] = row.children;
      setAttr(row, 'data-state', c.online ? 'online' : 'idle');
      setText(name.lastChild, c.name);
      setText(endpoint, c.endpoint || '--');
      setText(seen, c.lastHandshakeAgo || 'never');
      setText(rx, bytes(c.transfer?.received ?? 0));
      setText(tx, bytes(c.transfer?.sent ?? 0));
    }
  );
}

export async function refreshWireguard() {
  show(card(), wireguard.enabled);
  if (!wireguard.enabled) return;
  try {
    render(await api.get('/api/wireguard'));
  } catch (error) {
    if (error.status === 503) show(card(), false);
    else if (error.status === 401) message('Admin token required to read WireGuard status. Save any setting to enter it.');
    else if (!byId('wg-clients').children.length) message('WireGuard status unavailable');
  }
}

export async function loadWireguardSettings() {
  try {
    const data = await api.get('/api/settings/wireguard');
    wireguard.enabled = Boolean(data.enabled);
    wireguard.interface = data.interface || 'wg0';
  } catch {
    wireguard.enabled = false;
  }
  await refreshWireguard();
}

export function initWireguard() {
  on('slow-tick', refreshWireguard);
  loadWireguardSettings();
}
