import '../css/tokens.css';
import '../css/base.css';
import '../css/layout.css';
import '../css/components.css';
import '../css/modals.css';
import '../css/modes.css';

import { byId, show } from './dom.js';
import { on } from './bus.js';
import { loadSettings, state } from './state.js';
import { applyParamOverrides, openParamModal, welcomeAllowed } from './params.js';
import { cycleMode, initDisplay, toggleFullscreen, togglePause, toggleSound } from './display.js';
import { refreshServices, refreshStats, startPolling } from './poller.js';
import { initAlerts } from './alerts.js';
import { initStatus } from './status.js';
import { initShortcuts } from './shortcuts.js';
import { toast } from './toast.js';
import { initCpu } from './cards/cpu.js';
import { initMemory } from './cards/memory.js';
import { initTemperature } from './cards/temperature.js';
import { initLoad } from './cards/load.js';
import { initNetwork } from './cards/network.js';
import { initDisks } from './cards/disks.js';
import { initServices } from './cards/services.js';
import { initContainers } from './cards/containers.js';
import { initProcesses } from './cards/processes.js';
import { initWireguard } from './cards/wireguard.js';
import { initDialogs } from './modals/dialog.js';
import { initAuth } from './modals/auth.js';
import { initHelp, openHelp } from './modals/help.js';
import { initSysinfo, openSysinfo } from './modals/sysinfo.js';
import { initSettings, openSettings } from './modals/settings.js';
import { initApi, openApi } from './modals/api.js';
import { initChartModal, openChart } from './modals/chart.js';
import { initServicesEditor, openServices } from './modals/services.js';

const WELCOME_KEY = 'piDashboardWelcome';

async function refreshNow() {
  await Promise.all([refreshStats(), refreshServices()]);
  toast(state.online ? 'ok' : 'crit', state.online ? 'Refreshed' : 'Server unreachable', '', 1500);
}

const SHORTCUTS = [
  { keys: ['P'], label: 'Pause or resume refresh', run: togglePause },
  { keys: ['R'], label: 'Refresh now', run: refreshNow },
  { keys: ['C', 'K'], label: 'Cycle density: normal, compact, ultra', run: cycleMode },
  { keys: ['F'], label: 'Toggle fullscreen', run: toggleFullscreen },
  { keys: ['M'], label: 'Mute or unmute alert sound', run: toggleSound },
  { keys: ['G'], label: 'Open history charts', run: () => openChart('cpu') },
  { keys: ['S'], label: 'Settings', run: openSettings },
  { keys: ['I'], label: 'System information', run: openSysinfo },
  { keys: ['A'], label: 'API and MCP access', run: openApi },
  { keys: ['E'], label: 'Edit services', run: openServices },
  { keys: ['?'], label: 'Show this help', run: openHelp },
  { keys: ['Esc'], label: 'Close the open dialog', run: () => {} }
];

function initWelcome() {
  const hint = byId('welcome');
  let seen = false;
  try {
    seen = Boolean(localStorage.getItem(WELCOME_KEY));
  } catch {
    seen = true;
  }
  show(hint, !seen && welcomeAllowed());
  byId('welcome-close').addEventListener('click', () => {
    show(hint, false);
    try {
      localStorage.setItem(WELCOME_KEY, 'true');
    } catch {
      /* ignore */
    }
  });
}

function initConnectionToasts() {
  let wasOnline = null;
  on('connection', (online) => {
    if (wasOnline === true && !online) toast('crit', 'Connection lost', 'Retrying automatically', 5000);
    if (wasOnline === false && online) toast('ok', 'Reconnected', 'Live data is back');
    wasOnline = online;
  });
}

async function boot() {
  applyParamOverrides();
  initDialogs();
  initAuth();
  initDisplay();
  initStatus();
  initConnectionToasts();
  initAlerts();

  initCpu();
  initMemory();
  initTemperature();
  initLoad();
  initNetwork();
  initDisks();
  initServices();
  initContainers();
  initProcesses();

  initHelp(SHORTCUTS);
  initSysinfo();
  initSettings();
  initApi();
  initChartModal();
  initServicesEditor();
  initShortcuts(SHORTCUTS);
  initWelcome();

  await loadSettings();
  initWireguard();
  await startPolling();

  openParamModal({
    settings: openSettings,
    api: openApi,
    sysinfo: openSysinfo,
    services: openServices,
    help: openHelp,
    chart: openChart
  });
}

boot();
