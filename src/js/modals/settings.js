import { $, $$, byId, el, setText, show } from '../dom.js';
import { api } from '../api.js';
import { emit } from '../bus.js';
import { DEFAULT_SETTINGS, effective, saveSettings, state, THEMES } from '../state.js';
import { applyTheme } from '../display.js';
import { toast } from '../toast.js';
import { loadWireguardSettings, wireguard } from '../cards/wireguard.js';
import { openDialog } from './dialog.js';

const THRESHOLDS = [
  { key: 'cpu', label: 'CPU', unit: '%', min: 1, max: 100 },
  { key: 'memory', label: 'Memory', unit: '%', min: 1, max: 100 },
  { key: 'temperature', label: 'Temperature', unit: '°C', min: 20, max: 120 },
  { key: 'disk', label: 'Disk', unit: '%', min: 1, max: 100 }
];

let pickedTheme = 'default';
let saved = false;

function pickTheme(theme) {
  pickedTheme = theme;
  for (const button of $$('#theme-options button')) button.setAttribute('aria-checked', String(button.dataset.theme === theme));
  applyTheme(theme);
}

function fill(settings, wg) {
  pickTheme(settings.theme);
  byId('set-interval').value = settings.interval;
  byId('set-sound').checked = settings.sound;
  byId('set-ocbase').value = settings.overclockBase;
  for (const { key } of THRESHOLDS) {
    byId(`th-${key}-warning`).value = settings.thresholds[key].warning;
    byId(`th-${key}-critical`).value = settings.thresholds[key].critical;
  }
  byId('set-wg-enabled').checked = wg.enabled;
  byId('set-wg-iface').value = wg.interface;
  syncOutputs();
  validate();
}

function syncOutputs() {
  setText(byId('set-interval-out'), `${byId('set-interval').value} s`);
  setText(byId('set-ocbase-out'), `${Number(byId('set-ocbase').value).toFixed(1)} GHz`);
  show(byId('set-wg-iface-row'), byId('set-wg-enabled').checked);
}

function validate() {
  let valid = true;
  for (const { key, label, min, max } of THRESHOLDS) {
    const warning = byId(`th-${key}-warning`);
    const critical = byId(`th-${key}-critical`);
    const w = Number(warning.value);
    const c = Number(critical.value);
    const inRange = (n) => Number.isFinite(n) && n >= min && n <= max;
    let message = '';
    if (!inRange(w) || !inRange(c) || warning.value === '' || critical.value === '') message = `${label}: use values between ${min} and ${max}`;
    else if (w >= c) message = `${label}: warning must be below critical`;
    warning.setCustomValidity(message);
    critical.setCustomValidity(message);
    setText($(`[data-error="${key}"]`), message);
    if (message) valid = false;
  }
  const wgOn = byId('set-wg-enabled').checked;
  const iface = byId('set-wg-iface');
  iface.setCustomValidity(wgOn && !/^[A-Za-z0-9_.-]{1,15}$/.test(iface.value.trim()) ? 'Invalid interface name' : '');
  if (!iface.validity.valid) valid = false;
  byId('settings-save').disabled = !valid;
  return valid;
}

async function save() {
  if (!validate()) return;
  const thresholds = {};
  for (const { key } of THRESHOLDS) {
    thresholds[key] = {
      warning: Number(byId(`th-${key}-warning`).value),
      critical: Number(byId(`th-${key}-critical`).value)
    };
  }
  const button = byId('settings-save');
  button.disabled = true;
  try {
    await saveSettings({
      theme: pickedTheme,
      interval: Number(byId('set-interval').value),
      sound: byId('set-sound').checked,
      overclockBase: Number(byId('set-ocbase').value),
      thresholds
    });
    const wg = { enabled: byId('set-wg-enabled').checked, interface: byId('set-wg-iface').value.trim() || 'wg0' };
    if (wg.enabled !== wireguard.enabled || wg.interface !== wireguard.interface) {
      await api.put('/api/settings/wireguard', wg);
      await loadWireguardSettings();
    }
    saved = true;
    byId('dlg-settings').close();
    toast('ok', 'Settings saved', 'Shared with every device using this dashboard');
    emit('settings-saved');
  } catch (error) {
    toast('crit', 'Settings not saved', error.message, 6000);
  } finally {
    button.disabled = false;
  }
}

export function openSettings() {
  saved = false;
  fill(state.settings, wireguard);
  openDialog('dlg-settings');
}

export function initSettings() {
  byId('theme-options').append(
    ...Object.entries(THEMES).map(([key, name]) =>
      el(
        'button',
        { type: 'button', class: 'theme', role: 'radio', 'aria-checked': 'false', dataset: { theme: key }, onclick: () => pickTheme(key) },
        el('span', { class: 'theme-swatch', 'data-theme': key }, el('i'), el('i')),
        el('span', { text: name })
      )
    )
  );

  byId('threshold-fields').append(
    el('div', { class: 'th-row th-head' }, el('span'), el('span', { text: 'Warning' }), el('span', { text: 'Critical' })),
    ...THRESHOLDS.flatMap(({ key, label, unit, min, max }) => [
      el(
        'div',
        { class: 'th-row' },
        el('span', { class: 'field-label', text: label }),
        ...['warning', 'critical'].map((kind) =>
          el(
            'label',
            { class: 'num-input', dataset: { kind } },
            el('input', { type: 'number', id: `th-${key}-${kind}`, min, max, step: 1, inputMode: 'numeric', 'aria-label': `${label} ${kind} threshold` }),
            el('span', { text: unit })
          )
        )
      ),
      el('p', { class: 'field-error', dataset: { error: key }, role: 'alert' })
    ])
  );

  const form = byId('settings-form');
  form.addEventListener('input', () => {
    syncOutputs();
    validate();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save();
  });
  byId('settings-reset').addEventListener('click', () => {
    fill(structuredClone(DEFAULT_SETTINGS), { enabled: byId('set-wg-enabled').checked, interface: byId('set-wg-iface').value });
    toast('info', 'Defaults restored', 'Press Save to apply', 2500);
  });
  // The theme previews live while the modal is open; a cancel restores the saved one.
  byId('dlg-settings').addEventListener('close', () => {
    if (!saved) applyTheme(effective('theme'));
  });
  byId('btn-settings').addEventListener('click', openSettings);
}
