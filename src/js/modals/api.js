import { byId, copyText, setText, show } from '../dom.js';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { openDialog } from './dialog.js';

const KEY_PLACEHOLDER = 'YOUR_API_KEY';
let freshKey = null;
let clearArmed = false;

function renderUsage(config) {
  const origin = window.location.origin;
  const key = freshKey || KEY_PLACEHOLDER;
  const needsKey = config.hasKey;
  setText(byId('api-curl'), needsKey ? `curl -H "X-API-Key: ${key}" ${origin}/api/v1/system` : `curl ${origin}/api/v1/system`);

  const mcpPath = config.mcp?.path;
  show(byId('api-mcp'), Boolean(mcpPath) && config.enabled);
  if (mcpPath) {
    const url = `${origin}${mcpPath}`;
    setText(byId('api-mcp-url'), url);
    setText(
      byId('api-mcp-cmd'),
      `claude mcp add --transport http pi-dashboard ${url}${needsKey ? ` --header "Authorization: Bearer ${key}"` : ''}`
    );
  }
}

function render(config) {
  byId('api-enabled').checked = Boolean(config.enabled);
  show(byId('api-details'), Boolean(config.enabled));
  show(byId('api-usage'), Boolean(config.enabled));
  setText(byId('api-key-display'), freshKey || (config.hasKey ? '•'.repeat(32) : 'No key: the API is open to anyone who can reach it'));
  byId('api-key-display').classList.toggle('is-secret', Boolean(freshKey));
  show(byId('api-key-copy'), Boolean(freshKey));
  setText(
    byId('api-key-help'),
    freshKey
      ? 'Copy this key now. It is not stored and cannot be shown again.'
      : 'The key is shown once, right after generation. Only its hash is stored.'
  );
  show(byId('api-key-clear'), Boolean(config.hasKey));
  disarmClear();
  renderUsage(config);
}

function disarmClear() {
  clearArmed = false;
  setText(byId('api-key-clear'), 'Clear key');
}

async function update(body, done) {
  try {
    const config = await api.put('/api/settings/api', body);
    if (body.generateKey) freshKey = config.key || null;
    if (body.clearKey) freshKey = null;
    render(config);
    done?.(config);
  } catch (error) {
    toast('crit', 'API settings not saved', error.message, 6000);
    load();
  }
}

async function load() {
  try {
    render(await api.get('/api/settings/api'));
  } catch (error) {
    toast('crit', 'API settings unavailable', error.message);
  }
}

export function openApi() {
  freshKey = null;
  openDialog('dlg-api');
  load();
}

export function initApi() {
  byId('btn-api').addEventListener('click', openApi);
  byId('api-enabled').addEventListener('change', (event) => {
    const enabled = event.target.checked;
    update({ enabled }, () => toast('info', 'External API', enabled ? 'Enabled' : 'Disabled', 2000));
  });
  byId('api-key-generate').addEventListener('click', () => {
    update({ generateKey: true }, () => toast('ok', 'API key generated', 'Copy it now, it is shown only once', 5000));
  });
  byId('api-key-clear').addEventListener('click', () => {
    if (!clearArmed) {
      clearArmed = true;
      setText(byId('api-key-clear'), 'Confirm: remove key');
      setTimeout(disarmClear, 4000);
      return;
    }
    update({ clearKey: true }, () => toast('warn', 'API key removed', 'The API no longer requires a key'));
  });
  byId('api-key-copy').addEventListener('click', async () => {
    if (!freshKey) return;
    const ok = await copyText(freshKey);
    toast(ok ? 'ok' : 'crit', 'API key', ok ? 'Copied to clipboard' : 'Copy failed, select it manually', 2000);
  });
  byId('dlg-api').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const ok = await copyText(byId(button.dataset.copy).textContent);
    toast(ok ? 'ok' : 'crit', ok ? 'Copied' : 'Copy failed', ok ? 'Copied to clipboard' : 'Select the text and copy it manually', 2000);
  });
  byId('dlg-api').addEventListener('close', () => {
    freshKey = null;
  });
  byId('api-download').addEventListener('click', download);
}

async function download() {
  try {
    const [stats, info] = await Promise.all([api.get('/api/stats'), api.get('/api/sysinfo', { timeout: 20000 })]);
    const snapshot = {
      timestamp: Date.now(),
      system: info.system,
      cpu: { ...stats.cpu, ...info.cpu },
      memory: { ...stats.memory, type: info.memory?.type },
      temperature: stats.temperature,
      load: stats.load,
      os: { ...stats.os, ...info.os },
      disks: stats.disks,
      network: stats.network,
      containers: stats.containers,
      processes: stats.processes,
      baseboard: info.baseboard
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `pi-dashboard-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast('ok', 'Snapshot downloaded');
  } catch (error) {
    toast('crit', 'Download failed', error.message);
  }
}
