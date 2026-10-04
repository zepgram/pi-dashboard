import { api } from './api.js';
import { emit } from './bus.js';

export const THEMES = {
  default: 'Cyan & Purple',
  emerald: 'Emerald & Cyan',
  rose: 'Rose & Pink',
  amber: 'Amber & Red',
  indigo: 'Indigo & Violet'
};

export const MODES = ['normal', 'compact', 'ultra'];

export const DEFAULT_SETTINGS = Object.freeze({
  interval: 1,
  theme: 'default',
  sound: true,
  displayMode: 'normal',
  compact: false,
  overclockBase: 2.4,
  thresholds: {
    cpu: { warning: 70, critical: 90 },
    memory: { warning: 80, critical: 95 },
    temperature: { warning: 70, critical: 80 },
    disk: { warning: 80, critical: 95 }
  }
});

function normalize(raw = {}) {
  const base = structuredClone(DEFAULT_SETTINGS);
  const out = { ...base, ...raw };
  out.thresholds = { ...base.thresholds };
  for (const key of Object.keys(base.thresholds)) {
    const t = { ...base.thresholds[key], ...(raw.thresholds?.[key] || {}) };
    const warning = Number(t.warning);
    const critical = Number(t.critical);
    out.thresholds[key] = {
      warning: Number.isFinite(warning) ? warning : base.thresholds[key].warning,
      critical: Number.isFinite(critical) ? critical : base.thresholds[key].critical
    };
  }
  const interval = Number(out.interval);
  out.interval = Number.isFinite(interval) ? Math.min(60, Math.max(1, interval)) : base.interval;
  if (!THEMES[out.theme]) out.theme = base.theme;
  // Older configs only carried the `compact` boolean.
  out.displayMode = MODES.includes(raw.displayMode) ? raw.displayMode : raw.compact ? 'compact' : 'normal';
  out.compact = out.displayMode !== 'normal';
  out.sound = out.sound !== false;
  const oc = Number(out.overclockBase);
  out.overclockBase = Number.isFinite(oc) && oc > 0 ? oc : base.overclockBase;
  return out;
}

export const state = {
  settings: normalize(),
  // Display overrides from URL params: applied on screen, never persisted.
  overrides: {},
  stats: null,
  services: null,
  // null until the first answer, then true / false
  online: null,
  paused: false,
  historyAvailable: null
};

export const effective = (key) => state.overrides[key] ?? state.settings[key];

export async function loadSettings() {
  try {
    state.settings = normalize(await api.get('/api/settings'));
  } catch (error) {
    console.warn('Settings unavailable, using defaults:', error.message);
  }
  emit('settings', state.settings);
  return state.settings;
}

// Optimistic: the UI switches at once and reverts if the server refuses.
export async function saveSettings(patch) {
  const previous = state.settings;
  state.settings = normalize({ ...previous, ...patch });
  for (const key of Object.keys(patch)) delete state.overrides[key];
  emit('settings', state.settings);
  try {
    await api.put('/api/settings', state.settings);
    return true;
  } catch (error) {
    state.settings = previous;
    emit('settings', state.settings);
    throw error;
  }
}

export function levelFor(key, value) {
  const t = state.settings.thresholds[key];
  if (!t || typeof value !== 'number' || !Number.isFinite(value)) return 'ok';
  if (value >= t.critical) return 'crit';
  if (value >= t.warning) return 'warn';
  return 'ok';
}
