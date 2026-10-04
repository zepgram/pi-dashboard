import { byId, el, icon } from './dom.js';

const ICONS = { ok: 'check', info: 'info', warn: 'alert', crit: 'alert' };
const MAX_TOASTS = 4;

export function toast(level, title, message = '', duration = 3500) {
  const host = byId('toasts');
  const node = el(
    'div',
    { class: 'toast', dataset: { level }, role: level === 'crit' ? 'alert' : 'status' },
    icon(ICONS[level] || 'info', 'toast-icon'),
    el('div', { class: 'toast-text' }, el('strong', { text: title }), message && el('span', { text: message })),
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Dismiss', onclick: () => node.remove() }, icon('close'))
  );
  // Toasts must stay visible above an open modal, which lives in the top layer.
  const open = document.querySelectorAll('dialog[open]');
  const target = open[open.length - 1] || document.body;
  if (host.parentNode !== target) target.append(host);
  host.append(node);
  while (host.children.length > MAX_TOASTS) host.firstElementChild.remove();
  setTimeout(() => node.remove(), duration);
}
