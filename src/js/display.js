// Theme, density mode, sound, pause and fullscreen: header buttons + state.
import { byId, setAttr, show, setText } from './dom.js';
import { emit, on } from './bus.js';
import { effective, MODES, saveSettings, state } from './state.js';
import { refreshChartColors } from './charts.js';
import { toast } from './toast.js';

const MODE_NAMES = { normal: 'Normal', compact: 'Compact', ultra: 'Ultra compact' };

export function applyTheme(theme = effective('theme')) {
  if (document.documentElement.dataset.theme === theme) return;
  document.documentElement.dataset.theme = theme;
  refreshChartColors();
}

function applyMode() {
  const mode = effective('displayMode');
  document.body.classList.toggle('compact', mode === 'compact');
  document.body.classList.toggle('ultra', mode === 'ultra');
  const badge = byId('mode-badge');
  show(badge, mode !== 'normal');
  setText(badge, mode === 'compact' ? 'C' : 'U');
  setAttr(byId('btn-mode'), 'aria-label', `Display density: ${MODE_NAMES[mode]}`);
}

function applySound() {
  setAttr(byId('btn-sound'), 'aria-pressed', String(effective('sound')));
}

async function persist(patch) {
  try {
    await saveSettings(patch);
  } catch (error) {
    toast('crit', 'Not saved', error.message);
  }
}

export function cycleMode() {
  const next = MODES[(MODES.indexOf(effective('displayMode')) + 1) % MODES.length];
  toast('info', 'Display', `${MODE_NAMES[next]} mode`, 1800);
  persist({ displayMode: next, compact: next !== 'normal' });
}

export function toggleSound() {
  const sound = !effective('sound');
  toast('info', 'Sound', sound ? 'Alert sound on' : 'Alert sound muted', 1800);
  persist({ sound });
}

export function togglePause() {
  state.paused = !state.paused;
  setAttr(byId('btn-pause'), 'aria-pressed', String(state.paused));
  setAttr(byId('btn-pause'), 'aria-label', state.paused ? 'Resume refresh' : 'Pause refresh');
  emit('pause', state.paused);
}

export function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen?.().catch(() => toast('warn', 'Fullscreen', 'Not available in this browser'));
  }
}

export function initDisplay() {
  byId('btn-pause').addEventListener('click', togglePause);
  byId('btn-sound').addEventListener('click', toggleSound);
  byId('btn-mode').addEventListener('click', cycleMode);
  byId('btn-fullscreen').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    setAttr(byId('btn-fullscreen'), 'aria-pressed', String(Boolean(document.fullscreenElement)));
  });
  on('settings', () => {
    applyTheme();
    applyMode();
    applySound();
  });
  applyTheme();
  applyMode();
  applySound();
}
