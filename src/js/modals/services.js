import { byId, el, icon, setText, show } from '../dom.js';
import { api } from '../api.js';
import { refreshServices } from '../poller.js';
import { toast } from '../toast.js';
import { openDialog } from './dialog.js';

const CHECK_TYPES = ['http', 'https', 'tcp', 'redis', 'dns', 'interface'];

let draft = [];
let discovered = [];

const targetField = (service) => (service.checkType === 'interface' ? 'interface' : 'path');

function input(service, field, props) {
  return el('input', {
    class: 'input',
    value: service[field] ?? '',
    autocomplete: 'off',
    spellcheck: false,
    oninput: (event) => {
      service[field] = field === 'port' ? Number(event.target.value) : event.target.value;
      event.target.setCustomValidity('');
    },
    ...props
  });
}

function row(service, index) {
  const target = el('input', {
    class: 'input mono',
    autocomplete: 'off',
    spellcheck: false,
    'aria-label': 'Path or interface',
    oninput: (event) => {
      service[targetField(service)] = event.target.value;
    }
  });
  const syncTarget = () => {
    const isIface = service.checkType === 'interface';
    // Older configs keep the interface name in `path`.
    target.value = isIface ? service.interface ?? (service.path && service.path !== '/' ? service.path : '') : service.path ?? '/';
    target.placeholder = isIface ? 'wg0' : '/';
    target.disabled = !['http', 'https', 'interface'].includes(service.checkType);
  };
  syncTarget();

  const node = el(
    'div',
    { class: 'svc-row', dataset: { disabled: String(service.enabled === false) } },
    el('input', {
      type: 'checkbox',
      class: 'switch',
      checked: service.enabled !== false,
      'aria-label': 'Enabled',
      onchange: (event) => {
        service.enabled = event.target.checked;
        node.dataset.disabled = String(!service.enabled);
      }
    }),
    input(service, 'name', { type: 'text', placeholder: 'Name', maxLength: 50, 'aria-label': 'Service name', required: true }),
    input(service, 'host', { type: 'text', placeholder: 'localhost', class: 'input mono', 'aria-label': 'Host' }),
    input(service, 'port', { type: 'number', min: 1, max: 65535, placeholder: 'Port', class: 'input mono', 'aria-label': 'Port', required: true }),
    el(
      'select',
      {
        class: 'input',
        'aria-label': 'Check type',
        onchange: (event) => {
          service.checkType = event.target.value;
          syncTarget();
        }
      },
      CHECK_TYPES.map((type) => el('option', { value: type, text: type, selected: type === (service.checkType || 'tcp') }))
    ),
    target,
    el(
      'button',
      {
        class: 'icon-btn btn-danger',
        type: 'button',
        'aria-label': `Delete ${service.name || 'service'}`,
        title: 'Delete',
        onclick: () => {
          draft.splice(draft.indexOf(service), 1);
          render();
        }
      },
      icon('trash')
    )
  );
  node.dataset.index = index;
  return node;
}

function render() {
  byId('svc-list').replaceChildren(...draft.map(row));
  show(byId('svc-empty'), draft.length === 0);
  setText(byId('svc-count'), draft.length ? String(draft.length) : '');
  renderDiscovered();
}

function renderDiscovered() {
  const ports = new Set(draft.map((s) => Number(s.port)));
  const fresh = discovered.filter((s) => !ports.has(Number(s.port)));
  setText(byId('svc-disc-count'), fresh.length ? String(fresh.length) : '');
  byId('svc-disc').replaceChildren(
    ...fresh.map((service) =>
      el(
        'button',
        {
          class: 'svc-found',
          type: 'button',
          title: `Add ${service.name}`,
          onclick: () => {
            const { name, port, path = '/', host = 'localhost', icon: ic = 'server', checkType = 'tcp' } = service;
            draft.push({ name, port, path, host, icon: ic, checkType, enabled: true });
            render();
          }
        },
        icon('plus'),
        el('span', { class: 'svc-found-name', text: service.name }),
        el('span', { class: 'mono dim', text: `:${service.port}` })
      )
    )
  );
}

async function discover() {
  const empty = byId('svc-disc-empty');
  discovered = [];
  renderDiscovered();
  show(empty, true);
  setText(empty, 'Scanning listening ports…');
  try {
    const data = await api.get('/api/services/discover', { timeout: 30000 });
    discovered = Array.isArray(data.discovered) ? data.discovered : [];
    renderDiscovered();
    const left = byId('svc-disc').children.length;
    show(empty, left === 0);
    setText(empty, discovered.length ? 'Every detected service is already monitored' : 'No listening service detected');
  } catch (error) {
    setText(empty, `Scan failed (${error.message})`);
  }
}

function validate() {
  let firstInvalid = null;
  for (const node of byId('svc-list').children) {
    const [, name, , port] = node.children;
    name.setCustomValidity(name.value.trim() ? '' : 'Name is required');
    const p = Number(port.value);
    port.setCustomValidity(Number.isInteger(p) && p >= 1 && p <= 65535 ? '' : 'Port must be between 1 and 65535');
    firstInvalid ||= [name, port].find((field) => !field.validity.valid);
  }
  firstInvalid?.reportValidity();
  return !firstInvalid;
}

async function save() {
  if (!validate()) return;
  const button = byId('svc-save');
  button.disabled = true;
  setText(button, 'Saving…');
  try {
    await api.put('/api/services/config', {
      services: draft.map((s) => ({ ...s, name: String(s.name).trim(), host: String(s.host || '').trim() || 'localhost' }))
    });
    byId('dlg-services').close();
    toast('ok', 'Services saved');
    refreshServices();
  } catch (error) {
    toast('crit', 'Services not saved', error.message, 6000);
  } finally {
    button.disabled = false;
    setText(button, 'Save changes');
  }
}

export async function openServices() {
  draft = [];
  render();
  openDialog('dlg-services');
  try {
    const data = await api.get('/api/services/config');
    draft = (data.services || []).map((s) => ({ ...s }));
    render();
  } catch (error) {
    toast('crit', 'Services unavailable', error.message);
  }
  discover();
}

export function initServicesEditor() {
  byId('btn-services-edit').addEventListener('click', openServices);
  byId('svc-rescan').addEventListener('click', discover);
  byId('svc-save').addEventListener('click', save);
  byId('svc-add').addEventListener('click', () => {
    draft.push({ name: '', host: 'localhost', port: '', path: '/', checkType: 'tcp', icon: 'server', enabled: true });
    render();
    const last = byId('svc-list').lastElementChild;
    last.scrollIntoView({ block: 'nearest' });
    last.children[1].focus();
  });
}
