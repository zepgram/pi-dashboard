const API_URL = window.location.port === '5173' ? 'http://localhost:3001/api' : '/api';

// Clipboard helper with mobile fallback
async function copyToClipboard(text) {
  // Try modern API first
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Fall through to fallback
    }
  }
  
  // Fallback for mobile/older browsers
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  
  try {
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return true;
  } catch (e) {
    document.body.removeChild(textarea);
    return false;
  }
}

// Color themes
const COLOR_THEMES = {
  default: { accent: '#00d4ff', secondary: '#a855f7', name: 'Cyan & Purple' },
  emerald: { accent: '#10b981', secondary: '#06b6d4', name: 'Emerald & Cyan' },
  rose: { accent: '#f43f5e', secondary: '#ec4899', name: 'Rose & Pink' },
  amber: { accent: '#f59e0b', secondary: '#ef4444', name: 'Amber & Red' },
  indigo: { accent: '#6366f1', secondary: '#8b5cf6', name: 'Indigo & Violet' }
};

// Default settings
const DEFAULT_SETTINGS = {
  interval: 1,
  theme: 'default',
  sound: true,
  compact: false,
  thresholds: {
    cpu: { warning: 70, critical: 90 },
    memory: { warning: 80, critical: 95 },
    temperature: { warning: 70, critical: 80 },
    disk: { warning: 80, critical: 95 }
  }
};

// Current settings (will be loaded from API)
let settings = { ...DEFAULT_SETTINGS };
let UPDATE_INTERVAL = settings.interval * 1000;
let THRESHOLDS = settings.thresholds;

// Load settings from server API
async function loadSettingsFromServer() {
  try {
    const response = await fetch(`${API_URL}/settings`);
    if (response.ok) {
      const serverSettings = await response.json();
      settings = { ...DEFAULT_SETTINGS, ...serverSettings };
      UPDATE_INTERVAL = settings.interval * 1000;
      THRESHOLDS = settings.thresholds;
    }
  } catch (e) {
    console.error('Failed to load settings from server:', e);
  }
  return settings;
}

// Save settings to server API
async function saveSettings(newSettings) {
  try {
    settings = { ...settings, ...newSettings };
    const response = await fetch(`${API_URL}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    if (!response.ok) {
      console.error('Failed to save settings');
    }
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

// Apply color theme
function applyTheme(themeName) {
  const theme = COLOR_THEMES[themeName] || COLOR_THEMES.default;
  document.documentElement.style.setProperty('--accent-cyan', theme.accent);
  document.documentElement.style.setProperty('--accent-purple', theme.secondary);
  // Update glow colors
  document.documentElement.style.setProperty('--glow-cyan', `0 0 20px ${theme.accent}4d`);
  document.documentElement.style.setProperty('--glow-purple', `0 0 20px ${theme.secondary}4d`);
}

// Welcome banner for first-time users (keep in localStorage - per-browser)
const welcomeBanner = document.getElementById('welcome-banner');
const welcomeClose = document.getElementById('welcome-close');

function showWelcome() {
  const hasSeenWelcome = localStorage.getItem('piDashboardWelcome');
  if (!hasSeenWelcome) {
    setTimeout(() => {
      welcomeBanner.classList.add('visible');
    }, 500);
  }
}

function dismissWelcome() {
  welcomeBanner.classList.add('hiding');
  setTimeout(() => {
    welcomeBanner.classList.remove('visible', 'hiding');
  }, 500);
  localStorage.setItem('piDashboardWelcome', 'true');
}

welcomeClose.addEventListener('click', dismissWelcome);
showWelcome();

// Audio context for alert sounds
let audioContext = null;
let soundEnabled = true;

// Display mode: 'normal' | 'compact' | 'ultra'
let displayMode = 'normal';

function toggleCompactMode() {
  // Cycle: normal → compact → ultra → normal
  if (displayMode === 'normal') {
    displayMode = 'compact';
  } else if (displayMode === 'compact') {
    displayMode = 'ultra';
  } else {
    displayMode = 'normal';
  }
  
  settings.displayMode = displayMode;
  // Keep backward compat
  settings.compact = displayMode !== 'normal';
  saveSettings({ displayMode, compact: settings.compact });
  
  applyDisplayMode();
  
  const modeNames = { normal: 'Normal', compact: 'Compact', ultra: 'Ultra compact' };
  showToast('info', 'Display', `${modeNames[displayMode]} mode`);
}

function applyDisplayMode() {
  document.body.classList.remove('compact', 'ultra');
  if (displayMode === 'compact') {
    document.body.classList.add('compact');
  } else if (displayMode === 'ultra') {
    document.body.classList.add('ultra');
  }
  updateCompactButton();
}

function updateCompactButton() {
  const compactBtn = document.getElementById('compact-btn');
  compactBtn.classList.toggle('active', displayMode !== 'normal');
}

function initCompactMode() {
  // Load from settings (backward compat)
  if (settings.displayMode) {
    displayMode = settings.displayMode;
  } else if (settings.compact) {
    displayMode = 'compact';
  }
  applyDisplayMode();
}

function initAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

function playAlertSound(type = 'warning') {
  if (!soundEnabled) return;

  try {
    const ctx = initAudio();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Warning: higher pitch, shorter beeps
    // Critical: lower pitch, more urgent pattern
    if (type === 'critical') {
      oscillator.frequency.value = 440; // A4
      gainNode.gain.value = 0.3;
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.1);
      // Second beep
      setTimeout(() => {
        if (!soundEnabled) return;
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.frequency.value = 440;
        gain2.gain.value = 0.3;
        osc2.start();
        osc2.stop(ctx.currentTime + 0.1);
      }, 150);
    } else {
      oscillator.frequency.value = 660; // E5
      gainNode.gain.value = 0.2;
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.08);
    }
  } catch (e) {
    console.warn('Audio not supported:', e);
  }
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  settings.sound = soundEnabled;
  saveSettings({ sound: soundEnabled });
  updateSoundButton();
  showToast(soundEnabled ? 'success' : 'info', 'Sound', soundEnabled ? 'Alerts enabled' : 'Alerts muted');
}

function updateSoundButton() {
  const soundBtn = document.getElementById('sound-btn');
  const soundOn = soundBtn.querySelector('.sound-on');
  const soundOff = soundBtn.querySelector('.sound-off');
  soundOn.style.display = soundEnabled ? 'block' : 'none';
  soundOff.style.display = soundEnabled ? 'none' : 'block';
  soundBtn.classList.toggle('muted', !soundEnabled);
}

// Track alert states to avoid duplicate notifications
const alertStates = { cpu: 'normal', memory: 'normal', temperature: 'normal' };

// Threshold check configuration
const THRESHOLD_CHECKS = [
  { key: 'cpu', getValue: s => s.cpu.usage, card: '.cpu-card', label: 'CPU', unit: '%' },
  { key: 'memory', getValue: s => s.memory.percent, card: '.memory-card', label: 'Memory', unit: '%' },
  { key: 'temperature', getValue: s => s.temperature.main, card: '.temp-card', label: 'Temperature', unit: '°C' }
];

// Check thresholds and show alerts
function checkThresholds(stats) {
  let shouldPlaySound = false;
  let soundType = 'warning';

  for (const check of THRESHOLD_CHECKS) {
    const value = check.getValue(stats);
    const threshold = THRESHOLDS[check.key];
    const level = value >= threshold.critical ? 'critical' : value >= threshold.warning ? 'warning' : 'normal';

    if (level !== alertStates[check.key] && level !== 'normal') {
      showToast(
        level === 'critical' ? 'error' : 'info',
        `${check.label} ${level === 'critical' ? 'Critical' : 'Warning'}`,
        `${check.label} at ${value}${check.unit}`
      );
      shouldPlaySound = true;
      if (level === 'critical') soundType = 'critical';
    }
    alertStates[check.key] = level;
    document.querySelector(check.card).dataset.alert = level;
  }

  if (shouldPlaySound) playAlertSound(soundType);
}

// Connection state
let isConnected = true;
let consecutiveErrors = 0;
const MAX_ERRORS_BEFORE_DISCONNECT = 3;

// Update connection status UI
function setConnectionStatus(connected) {
  const statusIndicator = document.querySelector('.status-indicator');
  const statusText = statusIndicator.querySelector('.status-text');
  const pulse = statusIndicator.querySelector('.pulse');

  if (connected && !isConnected) {
    // Reconnected
    showToast('success', 'Connected', 'Dashboard reconnected to server');
  }

  isConnected = connected;

  if (connected) {
    statusIndicator.classList.remove('disconnected');
    statusText.textContent = 'Live';
    pulse.style.background = 'var(--accent-green)';
  } else {
    statusIndicator.classList.add('disconnected');
    statusText.textContent = 'Disconnected';
    pulse.style.background = 'var(--accent-red)';
  }
}

// DOM Elements
const elements = {
  hostname: document.getElementById('hostname'),
  cpuValue: document.getElementById('cpu-value'),
  cpuGauge: document.getElementById('cpu-gauge'),
  cpuSpeed: document.getElementById('cpu-speed'),
  coresGrid: document.getElementById('cores-grid'),
  memoryValue: document.getElementById('memory-value'),
  memoryGauge: document.getElementById('memory-gauge'),
  memorySummary: document.getElementById('memory-summary'),
  memoryBarUsed: document.getElementById('memory-bar-used'),
  memoryBarCache: document.getElementById('memory-bar-cache'),
  memoryUsed: document.getElementById('memory-used'),
  memoryCache: document.getElementById('memory-cache'),
  memoryFree: document.getElementById('memory-free'),
  tempValue: document.getElementById('temp-value'),
  tempBar: document.getElementById('temp-bar'),
  tempStatus: document.getElementById('temp-status'),
  tempMin: document.getElementById('temp-min'),
  tempMax: document.getElementById('temp-max'),
  tempThrottle: document.getElementById('temp-throttle'),
  uptimeDays: document.getElementById('uptime-days'),
  uptimeHours: document.getElementById('uptime-hours'),
  uptimeMins: document.getElementById('uptime-mins'),
  load1: document.getElementById('load-1'),
  load5: document.getElementById('load-5'),
  load15: document.getElementById('load-15'),
  bootTime: document.getElementById('boot-time'),
  disksGrid: document.getElementById('disks-grid'),
  containersGrid: document.getElementById('containers-grid'),
  containerCount: document.getElementById('container-count'),
  networkGrid: document.getElementById('network-grid'),
  servicesGrid: document.getElementById('services-grid'),
  processesList: document.getElementById('processes-list'),
  osInfo: document.getElementById('os-info'),
  archInfo: document.getElementById('arch-info'),
  lastUpdate: document.getElementById('last-update')
};

// Toast notification system
const toastContainer = document.getElementById('toast-container');

function showToast(type, title, message, duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon"><svg><use href="#icon-${type}"/></svg></div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close"><svg><use href="#icon-close"/></svg></button>
  `;
  toastContainer.appendChild(toast);

  const removeToast = () => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
  };

  toast.querySelector('.toast-close').addEventListener('click', removeToast);
  setTimeout(removeToast, duration);
}

// Animate number change
function animateValue(element, start, end, duration = 500) {
  const startTime = performance.now();
  const change = end - start;

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = start + change * easeOut;
    element.textContent = Math.round(current * 10) / 10;

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

// Format bytes to human readable (unified function)
function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

// Format time ago
function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// Format network speed
function formatSpeed(bytesPerSec) {
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  if (bytesPerSec >= 1024) {
    return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  }
  return `${bytesPerSec} B/s`;
}

// Format uptime
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return { days, hours, mins };
}

// Update gauge stroke with dynamic glow
function updateGauge(element, percent) {
  const circumference = 314.159;
  const offset = circumference - (percent / 100) * circumference;
  element.style.strokeDashoffset = offset;
  
  // Add/remove high-load class for glow effect
  if (percent > 80) {
    element.classList.add('high-load');
  } else {
    element.classList.remove('high-load');
  }
}

// Get temperature status
function getTempStatus(temp) {
  if (temp < 50) return { text: 'Normal', class: '' };
  if (temp < 70) return { text: 'Warm', class: 'warning' };
  return { text: 'Hot!', class: 'critical' };
}

// Create or update core bars (smooth updates)
function createCoreBars(cores) {
  const existingBars = elements.coresGrid.querySelectorAll('.core-bar');

  if (existingBars.length !== cores.length) {
    // Recreate only if count changed
    elements.coresGrid.innerHTML = cores.map((load, i) => `
      <div class="core-bar" title="Core ${i}: ${load}%">
        <div class="core-fill" style="--load: ${load}%"></div>
        <span class="core-label">${Math.round(load)}%</span>
      </div>
    `).join('');
  } else {
    // Update existing bars smoothly
    existingBars.forEach((bar, i) => {
      bar.querySelector('.core-fill').style.setProperty('--load', `${cores[i]}%`);
      bar.querySelector('.core-label').textContent = `${Math.round(cores[i])}%`;
      bar.title = `Core ${i}: ${cores[i]}%`;
    });
  }
}

// Create disk cards
function createDiskCards(disks) {
  elements.disksGrid.innerHTML = disks.map(disk => `
    <div class="disk-card">
      <div class="disk-header">
        <span class="disk-mount">${disk.mount}</span>
        <span class="disk-percent">${disk.percent}%</span>
      </div>
      <div class="disk-bar">
        <div class="disk-fill ${disk.percent > 80 ? 'warning' : ''}" style="width: ${disk.percent}%"></div>
      </div>
      <div class="disk-info">
        <span>${formatBytes(disk.used)} used</span>
        <span>${formatBytes(disk.available)} free</span>
      </div>
    </div>
  `).join('');
}

// Create container cards
function createContainerCards(containers) {
  const runningCount = containers.filter(c => c.state === 'running').length;
  elements.containerCount.textContent = `${runningCount} running`;

  if (containers.length === 0) {
    elements.containersGrid.innerHTML = '<div class="no-containers">No containers detected</div>';
    return;
  }

  elements.containersGrid.innerHTML = containers.map(container => {
    const statusClass = container.state === 'running' ? 'running' : container.state === 'paused' ? 'paused' : 'exited';
    return `
      <div class="container-card">
        <div class="container-header">
          <span class="container-name">${container.name}</span>
          <span class="container-status ${statusClass}"><span class="status-dot"></span>${container.state}</span>
        </div>
        <div class="container-image">${container.image}</div>
        <div class="container-stats">
          <div class="container-stat"><div class="container-stat-label">CPU</div><div class="container-stat-value cpu">${container.cpuPercent}%</div></div>
          <div class="container-stat"><div class="container-stat-label">Memory</div><div class="container-stat-value mem">${container.memPercent}%</div></div>
        </div>
      </div>
    `;
  }).join('');
}

// Create network cards
function createNetworkCards(network) {
  const { interfaces, stats } = network;

  if (!interfaces || interfaces.length === 0) {
    elements.networkGrid.innerHTML = '<div class="no-network">No network interfaces detected</div>';
    return;
  }

  elements.networkGrid.innerHTML = interfaces.map(iface => {
    const ifaceStats = stats.find(s => s.iface === iface.name) || { rxSec: 0, txSec: 0, rxBytes: 0, txBytes: 0 };
    return `
      <div class="network-card">
        <div class="network-header">
          <div class="network-iface">
            <div class="network-iface-icon"><svg><use href="#icon-wifi"/></svg></div>
            <span>${iface.name}</span>
          </div>
          <span class="network-ip">${iface.ip4}</span>
        </div>
        <div class="network-stats">
          <div class="network-stat">
            <div class="network-stat-header">
              <svg class="network-stat-icon download"><use href="#icon-arrow-down"/></svg>
              <span class="network-stat-label">Download</span>
            </div>
            <div class="network-stat-value download">${formatSpeed(ifaceStats.rxSec)}</div>
            <div class="network-stat-total">${formatBytes(ifaceStats.rxBytes)}</div>
          </div>
          <div class="network-stat">
            <div class="network-stat-header">
              <svg class="network-stat-icon upload"><use href="#icon-arrow-up"/></svg>
              <span class="network-stat-label">Upload</span>
            </div>
            <div class="network-stat-value upload">${formatSpeed(ifaceStats.txSec)}</div>
            <div class="network-stat-total">${formatBytes(ifaceStats.txBytes)}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Create services grid - icons are in HTML sprite (index.html)
function createServicesGrid(services) {
  if (!services || services.length === 0) {
    elements.servicesGrid.innerHTML = '<div class="no-services">No services configured</div>';
    return;
  }

  elements.servicesGrid.innerHTML = services.map(service => `
    <div class="service-card">
      <div class="service-icon"><svg><use href="#icon-${service.icon || 'server'}"/></svg></div>
      <div class="service-status ${service.status}"></div>
      <div class="service-info">
        <div class="service-name">${service.name}</div>
        <div class="service-latency">${service.status === 'online' ? `${service.latency}ms` : service.status}</div>
      </div>
      <div class="service-port">:${service.port}</div>
    </div>
  `).join('');
}

// Fetch and update services (separate from main stats)
async function updateServices() {
  try {
    const response = await fetch(`${API_URL}/services`);
    const services = await response.json();
    createServicesGrid(services);
  } catch (error) {
    console.error('Failed to fetch services:', error);
    elements.servicesGrid.innerHTML = '<div class="no-services">Failed to check services</div>';
  }
}

// Track current process rows for smart updates
const processRowsMap = new Map();

// Create or update processes list with smooth transitions
function createProcessesList(processes) {
  if (!processes || processes.length === 0) {
    elements.processesList.innerHTML = '<div class="no-processes">No processes available</div>';
    processRowsMap.clear();
    return;
  }

  // Remove "loading" or "no processes" message if present
  const noProcessesEl = elements.processesList.querySelector('.no-processes');
  if (noProcessesEl) noProcessesEl.remove();

  const currentPids = new Set(processes.map(p => p.pid));

  // Remove processes that no longer exist (with fade out)
  for (const [pid, row] of processRowsMap) {
    if (!currentPids.has(pid)) {
      row.classList.add('process-exit');
      row.addEventListener('animationend', () => row.remove(), { once: true });
      processRowsMap.delete(pid);
    }
  }

  // Update or create process rows
  processes.forEach((proc, index) => {
    let row = processRowsMap.get(proc.pid);

    if (row) {
      // Update existing row - only update values that changed
      const cpuValueEl = row.querySelector('.process-cpu .process-value');
      const cpuBarFill = row.querySelector('.process-cpu .process-bar-fill');
      const memValueEl = row.querySelector('.process-mem .process-value');
      const memBarFill = row.querySelector('.process-mem .process-bar-fill');
      const nameEl = row.querySelector('.process-name');

      if (cpuValueEl.textContent !== `${proc.cpu}%`) {
        cpuValueEl.textContent = `${proc.cpu}%`;
        cpuBarFill.style.width = `${Math.min(proc.cpu, 100)}%`;
        cpuValueEl.classList.add('value-changed');
        setTimeout(() => cpuValueEl.classList.remove('value-changed'), 300);
      }

      if (memValueEl.textContent !== `${proc.mem}%`) {
        memValueEl.textContent = `${proc.mem}%`;
        memBarFill.style.width = `${Math.min(proc.mem, 100)}%`;
        memValueEl.classList.add('value-changed');
        setTimeout(() => memValueEl.classList.remove('value-changed'), 300);
      }

      if (nameEl.textContent !== proc.name) {
        nameEl.textContent = proc.name;
        nameEl.title = proc.name;
      }

      const timeEl = row.querySelector('.process-time');
      if (timeEl.textContent !== (proc.time || '-')) timeEl.textContent = proc.time || '-';

      // Reorder if needed
      const currentIndex = Array.from(elements.processesList.children).indexOf(row);
      if (currentIndex !== index) {
        row.style.transform = `translateY(${(index - currentIndex) * 100}%)`;
        setTimeout(() => {
          elements.processesList.insertBefore(row, elements.processesList.children[index]);
          row.style.transform = '';
        }, 200);
      }
    } else {
      // Create new row with entrance animation
      row = document.createElement('div');
      row.className = 'process-row process-enter';
      row.dataset.pid = proc.pid;
      const cmdDisplay = proc.cmd || proc.name;
      row.innerHTML = `
        <span class="process-name" title="${proc.name}">${proc.name}</span>
        <span class="process-cmd" title="${cmdDisplay}">${cmdDisplay}</span>
        <span class="process-cpu">
          <div class="process-bar"><div class="process-bar-fill" style="width: ${Math.min(proc.cpu, 100)}%"></div></div>
          <span class="process-value">${proc.cpu}%</span>
        </span>
        <span class="process-mem">
          <div class="process-bar"><div class="process-bar-fill" style="width: ${Math.min(proc.mem, 100)}%"></div></div>
          <span class="process-value">${proc.mem}%</span>
        </span>
        <span class="process-time">${proc.time || '-'}</span>
        <span class="process-pid">${proc.pid}</span>
      `;

      // Insert at correct position
      if (elements.processesList.children[index]) {
        elements.processesList.insertBefore(row, elements.processesList.children[index]);
      } else {
        elements.processesList.appendChild(row);
      }

      processRowsMap.set(proc.pid, row);
      setTimeout(() => row.classList.remove('process-enter'), 300);
    }
  });
}

// Store previous values for animation
let prevValues = {
  cpu: 0,
  memory: 0,
  temp: 0
};

// Smoothie Charts for real-time graphs
let cpuChart, memoryChart, tempChart;
let cpuLine, memoryLine, tempLine;

// Initialize Smoothie Charts - identical settings for all 3
function initSmoothieCharts() {
  // Stop existing charts if reinitializing
  if (cpuChart) cpuChart.stop();
  if (memoryChart) memoryChart.stop();
  if (tempChart) tempChart.stop();

  // Use bezier for 1s interval (smooth curves), step for slower updates (holds value until next point)
  const interpolationType = settings.interval === 1 ? 'bezier' : 'step';

  const chartConfig = {
    responsive: true,
    millisPerPixel: 50,
    interpolation: interpolationType,
    maxValue: 100,
    minValue: 0,
    grid: {
      fillStyle: 'transparent',
      strokeStyle: 'transparent',
      borderVisible: false,
      verticalSections: 0,
      millisPerLine: 0
    },
    labels: {
      disabled: true
    },
    tooltip: false,
    limitFPS: 10
  };

  const lineConfig = (color) => ({
    strokeStyle: color,
    fillStyle: 'transparent',
    lineWidth: 2
  });

  // Use UPDATE_INTERVAL for stream delay to match data refresh rate
  const streamDelay = UPDATE_INTERVAL;

  // CPU
  cpuChart = new SmoothieChart(chartConfig);
  cpuLine = new TimeSeries();
  cpuChart.addTimeSeries(cpuLine, lineConfig('#00d4ff'));
  cpuChart.streamTo(document.getElementById('cpu-sparkline'), streamDelay);

  // Memory
  memoryChart = new SmoothieChart(chartConfig);
  memoryLine = new TimeSeries();
  memoryChart.addTimeSeries(memoryLine, lineConfig('#a855f7'));
  memoryChart.streamTo(document.getElementById('memory-sparkline'), streamDelay);

  // Temperature (same config, just different scale handled by data)
  tempChart = new SmoothieChart({ ...chartConfig, maxValue: 85 });
  tempLine = new TimeSeries();
  tempChart.addTimeSeries(tempLine, lineConfig('#f97316'));
  tempChart.streamTo(document.getElementById('temp-sparkline'), streamDelay);
}

// Update temperature line color based on value
function updateTempColor(temp) {
  if (!tempLine) return;
  const warningThreshold = settings.thresholds?.temperature?.warning || 60;
  const criticalThreshold = settings.thresholds?.temperature?.critical || 75;
  
  let color;
  if (temp >= criticalThreshold) {
    color = '#ef4444';
  } else if (temp >= warningThreshold) {
    color = '#f97316';
  } else {
    color = '#10b981';
  }
  
  // Update the chart colors (stroke only, no fill)
  if (tempChart && tempChart.seriesSet && tempChart.seriesSet[0]) {
    tempChart.seriesSet[0].options.strokeStyle = color;
    tempChart.seriesSet[0].options.fillStyle = 'transparent';
  }
}

// History arrays for modal charts
const HISTORY_LENGTH = 30;
const cpuHistory = [];
const memoryHistory = [];
const tempHistory = [];

// Temperature session min/max tracking
let tempMinSession = null;
let tempMaxSession = null;

// Get temperature color for modal chart
function getTempColor(temp) {
  const warningThreshold = settings.thresholds?.temperature?.warning || 60;
  const criticalThreshold = settings.thresholds?.temperature?.critical || 75;
  
  if (temp >= criticalThreshold) return '#ef4444';
  if (temp >= warningThreshold) return '#f97316';
  return '#10b981';
}

// Sparklines handled by Smoothie Charts

// Update dashboard
async function updateDashboard() {
  try {
    const response = await fetch(`${API_URL}/stats`);
    const stats = await response.json();

    // Update hostname
    elements.hostname.textContent = stats.os.hostname;

    // Update CPU
    animateValue(elements.cpuValue, prevValues.cpu, stats.cpu.usage);
    updateGauge(elements.cpuGauge, stats.cpu.usage);
    createCoreBars(stats.cpu.cores);
    prevValues.cpu = stats.cpu.usage;
    // Update CPU speed
    if (stats.cpu.speed && elements.cpuSpeed) {
      const speedText = `${stats.cpu.speed.toFixed(2)} GHz`;
      // Show overclock indicator only when running above base frequency
      const overclockBase = settings.overclockBase || 2.4;
      const isRunningOverclocked = stats.cpu.overclocked && stats.cpu.speed > overclockBase;
      if (isRunningOverclocked) {
        elements.cpuSpeed.innerHTML = `⚡ ${speedText}`;
        elements.cpuSpeed.classList.add('overclocked');
      } else {
        elements.cpuSpeed.textContent = speedText;
        elements.cpuSpeed.classList.remove('overclocked');
      }
    }
    // Update data-value for compact mode
    document.querySelector('.cpu-card .card-body')?.setAttribute('data-value', Math.round(stats.cpu.usage));

    // Update CPU history (for modal) and Smoothie chart
    cpuHistory.push(stats.cpu.usage);
    if (cpuHistory.length > HISTORY_LENGTH) cpuHistory.shift();
    if (cpuLine) cpuLine.append(Date.now(), stats.cpu.usage);

    // Update Memory
    animateValue(elements.memoryValue, prevValues.memory, stats.memory.percent);
    updateGauge(elements.memoryGauge, stats.memory.percent);
    elements.memorySummary.textContent = `${formatBytes(stats.memory.used + (stats.memory.buffcache || 0))} / ${formatBytes(stats.memory.total)}`;
    
    // Update memory bar
    const usedPercent = stats.memory.usedPercent || ((stats.memory.used / stats.memory.total) * 100);
    const cachePercent = stats.memory.buffcachePercent || 0;
    elements.memoryBarUsed.style.width = `${usedPercent}%`;
    elements.memoryBarCache.style.width = `${cachePercent}%`;
    elements.memoryBarCache.style.left = `${usedPercent}%`;
    
    // Update legend values
    elements.memoryUsed.textContent = formatBytes(stats.memory.used);
    elements.memoryCache.textContent = formatBytes(stats.memory.buffcache || 0);
    elements.memoryFree.textContent = formatBytes(stats.memory.free);
    prevValues.memory = stats.memory.percent;
    // Update data-value for compact mode
    document.querySelector('.memory-card .card-body')?.setAttribute('data-value', Math.round(stats.memory.percent));

    // Update Memory history and Smoothie chart
    memoryHistory.push(stats.memory.percent);
    if (memoryHistory.length > HISTORY_LENGTH) memoryHistory.shift();
    if (memoryLine) memoryLine.append(Date.now(), stats.memory.percent);

    // Update Temperature
    const temp = stats.temperature.main;
    animateValue(elements.tempValue, prevValues.temp, temp);
    elements.tempBar.style.setProperty('--temp-percent', `${(temp / 85) * 100}%`);
    const tempStatus = getTempStatus(temp);
    elements.tempStatus.textContent = tempStatus.text;
    elements.tempStatus.className = `temp-status ${tempStatus.class}`;
    prevValues.temp = temp;

    // Update Temperature min/max session tracking
    if (temp > 0) {
      if (tempMinSession === null || temp < tempMinSession) tempMinSession = temp;
      if (tempMaxSession === null || temp > tempMaxSession) tempMaxSession = temp;
      if (elements.tempMin) elements.tempMin.textContent = `${tempMinSession.toFixed(1)}°C`;
      if (elements.tempMax) elements.tempMax.textContent = `${tempMaxSession.toFixed(1)}°C`;
    }

    // Update Throttle status
    if (elements.tempThrottle && stats.temperature.throttled !== undefined) {
      const throttleEl = elements.tempThrottle;
      if (stats.temperature.throttled) {
        const reasons = stats.temperature.reasons || [];
        const currentReasons = reasons.filter(r => !r.includes('occurred'));
        throttleEl.innerHTML = `<span class="throttle-icon">⚠</span><span class="throttle-text">${currentReasons.join(', ') || 'Throttled'}</span>`;
        throttleEl.className = 'temp-throttle critical';
      } else if (stats.temperature.flags > 0) {
        // Historical throttling occurred but not currently active
        throttleEl.innerHTML = `<span class="throttle-icon">!</span><span class="throttle-text">Throttled earlier</span>`;
        throttleEl.className = 'temp-throttle warning';
      } else {
        throttleEl.innerHTML = `<span class="throttle-icon">✓</span><span class="throttle-text">No throttling</span>`;
        throttleEl.className = 'temp-throttle';
      }
    }

    // Update Temperature history and Smoothie chart
    tempHistory.push(temp);
    if (tempHistory.length > HISTORY_LENGTH) tempHistory.shift();
    if (tempLine) {
      tempLine.append(Date.now(), temp);
      updateTempColor(temp);
    }

    // Update Uptime
    const uptime = formatUptime(stats.load.uptime);
    elements.uptimeDays.textContent = uptime.days;
    elements.uptimeHours.textContent = uptime.hours;
    elements.uptimeMins.textContent = uptime.mins;

    // Update Boot Time
    if (elements.bootTime && stats.load.uptime) {
      const bootDate = new Date(Date.now() - stats.load.uptime * 1000);
      const options = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
      elements.bootTime.textContent = bootDate.toLocaleDateString('en-GB', options);
    }

    // Update Load Averages
    if (stats.load.loadAvg) {
      elements.load1.textContent = (stats.load.loadAvg[0] || 0).toFixed(2);
      elements.load5.textContent = (stats.load.loadAvg[1] || 0).toFixed(2);
      elements.load15.textContent = (stats.load.loadAvg[2] || 0).toFixed(2);
    }

    // Update Disks
    createDiskCards(stats.disks);

    // Update Containers
    createContainerCards(stats.containers || []);

    // Update Network
    createNetworkCards(stats.network || { interfaces: [], stats: [] });

    // Update Processes
    createProcessesList(stats.processes || []);

    // Update Footer
    elements.osInfo.textContent = `${stats.os.distro} ${stats.os.release}`;
    elements.archInfo.textContent = stats.os.arch;

    // Update last update time with pulse effect
    const now = Date.now();
    lastUpdateTimestamp = now;
    elements.lastUpdate.textContent = new Date().toLocaleTimeString();

    // Check thresholds and show alerts
    checkThresholds(stats);

    // Update modal chart if open
    updateModalChart();

    // Connection successful
    consecutiveErrors = 0;
    setConnectionStatus(true);

  } catch (error) {
    console.error('Failed to fetch stats:', error);
    consecutiveErrors++;

    if (consecutiveErrors >= MAX_ERRORS_BEFORE_DISCONNECT) {
      setConnectionStatus(false);
    }
  }
}

// Start update loops
let updateIntervalId = null;

// Initialize app - load settings from server first
async function initApp() {
  await loadSettingsFromServer();
  
  // Apply loaded settings
  applyTheme(settings.theme || 'default');
  soundEnabled = settings.sound !== false;
  // Load display mode (backward compat with compact boolean)
  if (settings.displayMode) {
    displayMode = settings.displayMode;
  } else if (settings.compact) {
    displayMode = 'compact';
  }
  applyDisplayMode();
  UPDATE_INTERVAL = settings.interval * 1000;
  
  // Initialize Smoothie Charts
  initSmoothieCharts();
  
  // Initial update
  updateDashboard();
  updateServices();
  
  // Start update loops
  updateIntervalId = setInterval(updateDashboard, UPDATE_INTERVAL);
  setInterval(updateServices, 10000); // Check services every 10 seconds
}

initApp();

// Track last update timestamp
let lastUpdateTimestamp = Date.now();

// Update time ago display every 5 seconds (was 1s - reduced for CPU)
const lastUpdateAgoEl = document.getElementById('last-update-ago');
setInterval(() => {
  if (lastUpdateTimestamp) {
    lastUpdateAgoEl.textContent = `(${formatTimeAgo(lastUpdateTimestamp)})`;
  }
}, 5000);

// Pause updates when tab is hidden (saves CPU)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Pause charts and updates
    if (cpuChart) cpuChart.stop();
    if (memoryChart) memoryChart.stop();
    if (tempChart) tempChart.stop();
    clearInterval(updateIntervalId);
  } else {
    // Resume charts and updates
    if (cpuChart) cpuChart.start();
    if (memoryChart) memoryChart.start();
    if (tempChart) tempChart.start();
    updateDashboard(); // Immediate refresh
    updateIntervalId = setInterval(updateDashboard, UPDATE_INTERVAL);
  }
});

// Remove focus from action buttons after click (prevent sticky hover state)
document.querySelectorAll('.action-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    setTimeout(() => this.blur(), 100);
  });
});

// Refresh button
document.getElementById('refresh-btn').addEventListener('click', function() {
  this.classList.add('spinning');
  updateDashboard().then(() => {
    setTimeout(() => this.classList.remove('spinning'), 600);
    showToast('success', 'Refreshed', 'Dashboard data updated');
  });
});

// Settings panel
const settingsOverlay = document.getElementById('settings-overlay');
const settingsBtn = document.getElementById('settings-btn');
const settingsClose = document.getElementById('settings-close');
const settingsSave = document.getElementById('settings-save');
const settingsReset = document.getElementById('settings-reset');

// Settings inputs
const settingInputs = {
  interval: document.getElementById('setting-interval'),
  cpuWarning: document.getElementById('setting-cpu-warning'),
  cpuCritical: document.getElementById('setting-cpu-critical'),
  memWarning: document.getElementById('setting-mem-warning'),
  memCritical: document.getElementById('setting-mem-critical'),
  tempWarning: document.getElementById('setting-temp-warning'),
  tempCritical: document.getElementById('setting-temp-critical'),
  overclockBase: document.getElementById('setting-overclock-base')
};

// Settings value displays
const settingValues = {
  interval: document.getElementById('interval-value'),
  cpuWarning: document.getElementById('cpu-warning-value'),
  cpuCritical: document.getElementById('cpu-critical-value'),
  memWarning: document.getElementById('mem-warning-value'),
  memCritical: document.getElementById('mem-critical-value'),
  tempWarning: document.getElementById('temp-warning-value'),
  tempCritical: document.getElementById('temp-critical-value'),
  overclockBase: document.getElementById('overclock-base-value')
};

// Settings configuration: [inputKey, suffix, getter, setter, parseFunc]
const SETTINGS_CONFIG = [
  ['interval', 's', () => settings.interval, v => settings.interval = v, parseInt],
  ['cpuWarning', '%', () => settings.thresholds.cpu.warning, v => settings.thresholds.cpu.warning = v, parseInt],
  ['cpuCritical', '%', () => settings.thresholds.cpu.critical, v => settings.thresholds.cpu.critical = v, parseInt],
  ['memWarning', '%', () => settings.thresholds.memory.warning, v => settings.thresholds.memory.warning = v, parseInt],
  ['memCritical', '%', () => settings.thresholds.memory.critical, v => settings.thresholds.memory.critical = v, parseInt],
  ['tempWarning', '°C', () => settings.thresholds.temperature.warning, v => settings.thresholds.temperature.warning = v, parseInt],
  ['tempCritical', '°C', () => settings.thresholds.temperature.critical, v => settings.thresholds.temperature.critical = v, parseInt],
  ['overclockBase', ' GHz', () => settings.overclockBase || 2.4, v => settings.overclockBase = v, parseFloat]
];

// Update value displays when sliders change
function updateSettingDisplay(key, value, suffix = '') {
  if (settingValues[key]) settingValues[key].textContent = value + suffix;
}

// Theme selector
const themeSelector = document.getElementById('theme-selector');
let selectedTheme = settings.theme || 'default';

function updateThemeButtons() {
  themeSelector.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === selectedTheme);
  });
}

themeSelector.addEventListener('click', (e) => {
  const btn = e.target.closest('.theme-option');
  if (btn) {
    selectedTheme = btn.dataset.theme;
    updateThemeButtons();
    applyTheme(selectedTheme);
  }
});

// Initialize settings UI with current values
function initSettingsUI() {
  SETTINGS_CONFIG.forEach(([key, suffix, getter]) => {
    settingInputs[key].value = getter();
    updateSettingDisplay(key, getter(), suffix);
  });
  selectedTheme = settings.theme || 'default';
  updateThemeButtons();
}

// Add input listeners (loop instead of 8 separate handlers)
SETTINGS_CONFIG.forEach(([key, suffix]) => {
  settingInputs[key].addEventListener('input', () => {
    updateSettingDisplay(key, settingInputs[key].value, suffix);
  });
});

// Open/close settings
function openSettings() { initSettingsUI(); settingsOverlay.classList.add('active'); }
function closeSettings() { settingsOverlay.classList.remove('active'); }

// Save settings
function applySettings() {
  const newInterval = parseInt(settingInputs.interval.value, 10);
  const intervalChanged = newInterval !== settings.interval;

  SETTINGS_CONFIG.forEach(([key, , , setter, parse]) => {
    setter(parse(settingInputs[key].value, 10));
  });
  settings.theme = selectedTheme;

  saveSettings(settings);

  // Update interval if changed
  if (intervalChanged) {
    UPDATE_INTERVAL = settings.interval * 1000;
    clearInterval(updateIntervalId);
    updateIntervalId = setInterval(updateDashboard, UPDATE_INTERVAL);
    // Reinitialize charts with new stream delay
    initSmoothieCharts();
  }

  closeSettings();
  showToast('success', 'Settings Saved', 'Your preferences have been updated');
}

// Reset to defaults
function resetSettings() {
  settings = { ...DEFAULT_SETTINGS, thresholds: { ...DEFAULT_SETTINGS.thresholds } };
  selectedTheme = 'default';
  applyTheme('default');
  initSettingsUI();
  showToast('info', 'Reset', 'Settings reset to defaults');
}

// Event listeners
settingsBtn.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsSave.addEventListener('click', applySettings);
settingsReset.addEventListener('click', resetSettings);

// Close on overlay click
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) {
    closeSettings();
  }
});

// Close modals on Escape key (centralized handler)
const ESCAPE_HANDLERS = [
  [() => settingsOverlay.classList.contains('active'), closeSettings],
  [() => sysinfoOverlay.classList.contains('active'), closeSysinfo],
  [() => chartModal.classList.contains('active'), closeChartModal],
  [() => apiOverlay.classList.contains('active'), closeApiModal],
  [() => typeof servicesConfigOverlay !== 'undefined' && servicesConfigOverlay.classList.contains('active'), () => closeServicesConfig()]
];
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') ESCAPE_HANDLERS.find(([check]) => check())?.[1]();
});

// Initialize settings UI
initSettingsUI();

// ===================
// API Modal
// ===================

const apiOverlay = document.getElementById('api-overlay');
const apiBtn = document.getElementById('api-btn');
const apiClose = document.getElementById('api-close');
const apiDownload = document.getElementById('api-download');
const apiEnabled = document.getElementById('api-enabled');
const apiKeySection = document.getElementById('api-key-section');
const apiKeyDisplay = document.getElementById('api-key-display');
const apiKeyGenerate = document.getElementById('api-key-generate');
const apiKeyCopy = document.getElementById('api-key-copy');
const apiEndpointCopy = document.getElementById('api-endpoint-copy');
const apiCurlUrl = document.getElementById('api-curl-url');

// Get base URL
function getBaseUrl() {
  return `${window.location.protocol}//${window.location.host}`;
}

// Open/close API modal
const apiEndpointUrl = document.getElementById('api-endpoint-url');

function openApiModal() {
  loadApiSettings();
  const fullUrl = `${getBaseUrl()}/api/v1/system`;
  apiEndpointUrl.textContent = fullUrl;
  apiCurlUrl.textContent = fullUrl;
  apiOverlay.classList.add('active');
}

function closeApiModal() {
  apiOverlay.classList.remove('active');
}

apiBtn.addEventListener('click', openApiModal);
apiClose.addEventListener('click', closeApiModal);
apiOverlay.addEventListener('click', (e) => {
  if (e.target === apiOverlay) closeApiModal();
});

// Download JSON
apiDownload.addEventListener('click', async () => {
  try {
    const response = await fetch(`${API_URL}/stats`);
    const stats = await response.json();
    
    const infoResponse = await fetch(`${API_URL}/sysinfo`);
    const info = await infoResponse.json();
    
    const data = {
      timestamp: Date.now(),
      system: info.system,
      cpu: { ...stats.cpu, ...info.cpu },
      memory: { ...stats.memory, type: info.memory.type },
      temperature: stats.temperature,
      load: stats.load,
      os: { ...stats.os, ...info.os },
      disks: stats.disks,
      network: stats.network,
      containers: stats.containers,
      processes: stats.processes,
      baseboard: info.baseboard
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pi-dashboard-${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('success', 'Downloaded', 'JSON exported successfully');
  } catch (e) {
    console.error('Download failed:', e);
    showToast('error', 'Error', 'Failed to download data');
  }
});

// Track if we just generated a key (for copy button)
let apiKeyJustGenerated = false;

// Load API settings
async function loadApiSettings() {
  try {
    const response = await fetch(`${API_URL}/settings/api`);
    if (response.ok) {
      const data = await response.json();
      apiEnabled.checked = data.enabled;
      apiKeySection.style.display = data.enabled ? 'block' : 'none';
      
      // Reset state when loading
      apiKeyJustGenerated = false;
      apiKeyCopy.style.display = 'none';
      
      if (data.hasKey) {
        apiKeyDisplay.value = '••••••••••••••••••••••••••••••••';
        apiKeyDisplay.placeholder = '';
      } else {
        apiKeyDisplay.value = '';
        apiKeyDisplay.placeholder = 'No key generated';
      }
    }
  } catch (e) {
    console.error('Failed to load API settings:', e);
  }
}

// Toggle API enabled
apiEnabled.addEventListener('change', async () => {
  const enabled = apiEnabled.checked;
  apiKeySection.style.display = enabled ? 'block' : 'none';
  
  try {
    await fetch(`${API_URL}/settings/api`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    showToast(enabled ? 'success' : 'info', 'API', enabled ? 'API enabled' : 'API disabled');
  } catch (e) {
    console.error('Failed to update API settings:', e);
  }
});

// Generate new API key
apiKeyGenerate.addEventListener('click', async () => {
  try {
    const response = await fetch(`${API_URL}/settings/api`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generateKey: true })
    });
    if (response.ok) {
      const data = await response.json();
      apiKeyDisplay.value = data.key;
      apiKeyJustGenerated = true;
      apiKeyCopy.style.display = 'flex';
      showToast('success', 'API Key', 'New key generated — copy it now!');
    }
  } catch (e) {
    console.error('Failed to generate API key:', e);
  }
});

// Copy API key (only available right after generation)
apiKeyCopy.addEventListener('click', async () => {
  if (!apiKeyJustGenerated) {
    return;
  }
  const key = apiKeyDisplay.value;
  if (key && key !== '' && !key.includes('•')) {
    const success = await copyToClipboard(key);
    if (success) {
      showToast('success', 'Copied', 'API key copied to clipboard');
    } else {
      showToast('error', 'Error', 'Failed to copy');
    }
  }
});

// Copy endpoint URL
apiEndpointCopy.addEventListener('click', async () => {
  const url = `${getBaseUrl()}/api/v1/system`;
  const success = await copyToClipboard(url);
  if (success) {
    showToast('success', 'Copied', 'Endpoint URL copied');
  } else {
    showToast('error', 'Error', 'Failed to copy');
  }
});

// Sound button
document.getElementById('sound-btn').addEventListener('click', toggleSound);
updateSoundButton();

// Compact mode button
document.getElementById('compact-btn').addEventListener('click', toggleCompactMode);
initCompactMode();

// Auto-hide header on scroll
let lastScrollY = 0;
let headerHidden = false;
const header = document.querySelector('header');

function handleScroll() {
  const scrollY = window.scrollY || window.pageYOffset;

  // Auto-hide header (only when scrolled past a threshold)
  if (scrollY > 100) {
    const scrollingDown = scrollY > lastScrollY;
    if (scrollingDown && !headerHidden) {
      header.classList.add('header-hidden');
      headerHidden = true;
    } else if (!scrollingDown && headerHidden) {
      header.classList.remove('header-hidden');
      headerHidden = false;
    }
  } else if (headerHidden) {
    header.classList.remove('header-hidden');
    headerHidden = false;
  }

  lastScrollY = scrollY;
}

window.addEventListener('scroll', handleScroll, { passive: true });

// Chart modal
const chartModal = document.getElementById('chart-modal');
const chartModalClose = document.getElementById('chart-modal-close');
const chartModalTitle = document.getElementById('chart-modal-title');
const largeChart = document.getElementById('large-chart');
const chartCurrent = document.getElementById('chart-current');
const chartAvg = document.getElementById('chart-avg');
const chartMax = document.getElementById('chart-max');
const chartMin = document.getElementById('chart-min');

let activeChartType = null;

// Modal chart instance
let modalChart = null;
let modalLine = null;

function renderLargeChart(history, color, label, unit = '%') {
  if (!history || history.length < 2) return;

  const canvas = document.getElementById('large-chart');
  if (!canvas) return;

  const isTemp = unit === '°C';
  const maxVal = isTemp ? 85 : 100;

  // Destroy previous chart if exists
  if (modalChart) {
    modalChart.stop();
    modalChart = null;
  }

  // Create new chart with Y axis labels
  modalChart = new SmoothieChart({
    responsive: true,
    millisPerPixel: 50,
    interpolation: 'bezier',
    maxValue: maxVal,
    minValue: 0,
    grid: {
      fillStyle: 'transparent',
      strokeStyle: 'rgba(255,255,255,0.06)',
      borderVisible: false,
      verticalSections: 4,
      millisPerLine: 0
    },
    labels: {
      fillStyle: 'rgba(255,255,255,0.4)',
      fontSize: 11,
      fontFamily: 'SF Mono, Monaco, monospace',
      precision: 0
    },
    tooltip: false,
    limitFPS: 30
  });

  modalLine = new TimeSeries();

  // Add historical data with proper time spacing (already in the past)
  const now = Date.now();
  const interval = 1000; // 1 second between points
  history.forEach((value, index) => {
    const timestamp = now - (history.length - index) * interval;
    modalLine.append(timestamp, value);
  });

  modalChart.addTimeSeries(modalLine, {
    strokeStyle: color,
    fillStyle: 'transparent',
    lineWidth: 2
  });

  // Start streaming (1000ms = smooth)
  modalChart.streamTo(canvas, 1000);

  // Update stats
  const current = history[history.length - 1];
  const avg = Math.round((history.reduce((a, b) => a + b, 0) / history.length) * 10) / 10;
  const maxValue = Math.max(...history);
  const minValue = Math.min(...history);

  chartCurrent.textContent = `${current}${unit}`;
  chartAvg.textContent = `${avg}${unit}`;
  chartMax.textContent = `${maxValue}${unit}`;
  chartMin.textContent = `${minValue}${unit}`;
  chartModalTitle.textContent = `${label} History`;
  
  // Set stat value colors to match chart
  chartCurrent.style.color = color;
  chartAvg.style.color = color;
  chartMax.style.color = color;
  chartMin.style.color = color;
}

function getChartConfig(type) {
  switch (type) {
    case 'cpu':
      return { history: cpuHistory, color: '#00d4ff', label: 'CPU', unit: '%' };
    case 'memory':
      return { history: memoryHistory, color: '#a855f7', label: 'Memory', unit: '%' };
    case 'temp':
      const currentTemp = tempHistory[tempHistory.length - 1] || 0;
      return { history: tempHistory, color: getTempColor(currentTemp), label: 'Temperature', unit: '°C' };
    default:
      return { history: [], color: '#00d4ff', label: '', unit: '%' };
  }
}

function openChartModal(type) {
  activeChartType = type;
  const config = getChartConfig(type);
  renderLargeChart(config.history, config.color, config.label, config.unit);
  chartModal.classList.add('active');
}

function closeChartModal() {
  chartModal.classList.remove('active');
  activeChartType = null;
  // Stop modal chart when closing
  if (modalChart) {
    modalChart.stop();
    modalChart = null;
    modalLine = null;
  }
}

// Click handlers for sparklines
document.querySelector('.cpu-card .sparkline-container').addEventListener('click', () => openChartModal('cpu'));
document.querySelector('.memory-card .sparkline-container').addEventListener('click', () => openChartModal('memory'));
document.querySelector('.temp-card .sparkline-container')?.addEventListener('click', () => openChartModal('temp'));

chartModalClose.addEventListener('click', closeChartModal);
chartModal.addEventListener('click', (e) => {
  if (e.target === chartModal) closeChartModal();
});

// Update modal chart if open
function updateModalChart() {
  if (activeChartType && chartModal.classList.contains('active') && modalLine) {
    const config = getChartConfig(activeChartType);
    const history = config.history;
    if (history.length > 0) {
      // Add latest point to streaming chart
      modalLine.append(Date.now(), history[history.length - 1]);
      
      // Update stats
      const current = history[history.length - 1];
      const avg = Math.round((history.reduce((a, b) => a + b, 0) / history.length) * 10) / 10;
      const maxValue = Math.max(...history);
      const minValue = Math.min(...history);
      
      chartCurrent.textContent = `${current}${config.unit}`;
      chartAvg.textContent = `${avg}${config.unit}`;
      chartMax.textContent = `${maxValue}${config.unit}`;
      chartMin.textContent = `${minValue}${config.unit}`;
      
      // Update colors (important for temperature which changes dynamically)
      chartCurrent.style.color = config.color;
      chartAvg.style.color = config.color;
      chartMax.style.color = config.color;
      chartMin.style.color = config.color;
    }
  }
}

// System Info Panel
const sysinfoOverlay = document.getElementById('sysinfo-overlay');
const sysinfoBtn = document.getElementById('sysinfo-btn');
const sysinfoClose = document.getElementById('sysinfo-close');
const sysinfoBody = document.getElementById('sysinfo-body');

async function openSysinfo() {
  sysinfoOverlay.classList.add('active');
  sysinfoBody.innerHTML = '<div class="sysinfo-loading">Loading system information...</div>';

  try {
    const response = await fetch(`${API_URL}/sysinfo`);
    const info = await response.json();

    sysinfoBody.innerHTML = `
      <div class="sysinfo-section">
        <h3><svg><use href="#icon-sysinfo-cpu"/></svg>Processor</h3>
        <div class="sysinfo-grid">
          <div class="sysinfo-item full-width">
            <div class="sysinfo-label">Model</div>
            <div class="sysinfo-value highlight">${info.cpu.manufacturer} ${info.cpu.brand}</div>
          </div>
          <div class="sysinfo-item">
            <div class="sysinfo-label">Cores</div>
            <div class="sysinfo-value">${info.cpu.cores} (${info.cpu.physicalCores} physical)</div>
          </div>
          <div class="sysinfo-item">
            <div class="sysinfo-label">Speed</div>
            <div class="sysinfo-value">${info.cpu.speed} GHz (max ${info.cpu.speedMax} GHz)</div>
          </div>
        </div>
      </div>
      <div class="sysinfo-section">
        <h3><svg><use href="#icon-sysinfo-mem"/></svg>Memory</h3>
        <div class="sysinfo-grid">
          <div class="sysinfo-item">
            <div class="sysinfo-label">Total RAM</div>
            <div class="sysinfo-value highlight">${formatBytes(info.memory.total, 2)}</div>
          </div>
          <div class="sysinfo-item">
            <div class="sysinfo-label">Type</div>
            <div class="sysinfo-value">${info.memory.type || 'Unknown'}</div>
          </div>
        </div>
      </div>
      <div class="sysinfo-section">
        <h3><svg><use href="#icon-sysinfo-sys"/></svg>System</h3>
        <div class="sysinfo-grid">
          <div class="sysinfo-item">
            <div class="sysinfo-label">Manufacturer</div>
            <div class="sysinfo-value">${info.system.manufacturer || 'Unknown'}</div>
          </div>
          <div class="sysinfo-item">
            <div class="sysinfo-label">Model</div>
            <div class="sysinfo-value">${info.system.model || 'Unknown'}</div>
          </div>
          <div class="sysinfo-item">
            <div class="sysinfo-label">Board</div>
            <div class="sysinfo-value">${info.baseboard.manufacturer} ${info.baseboard.model}</div>
          </div>
          <div class="sysinfo-item">
            <div class="sysinfo-label">Version</div>
            <div class="sysinfo-value">${info.baseboard.version || 'N/A'}</div>
          </div>
        </div>
      </div>
      <div class="sysinfo-section">
        <h3><svg><use href="#icon-sysinfo-os"/></svg>Operating System</h3>
        <div class="sysinfo-grid">
          <div class="sysinfo-item full-width">
            <div class="sysinfo-label">Distribution</div>
            <div class="sysinfo-value highlight">${info.os.distro}</div>
          </div>
          <div class="sysinfo-item">
            <div class="sysinfo-label">Version</div>
            <div class="sysinfo-value">${info.os.version || info.os.release}</div>
          </div>
          <div class="sysinfo-item">
            <div class="sysinfo-label">Updates</div>
            <div class="sysinfo-value ${info.os.updatesAvailable > 0 ? 'warning' : 'success'}">${info.os.updatesAvailable > 0 ? `${info.os.updatesAvailable} updates` : 'Up to date ✓'}</div>
          </div>
          <div class="sysinfo-item">
            <div class="sysinfo-label">Kernel</div>
            <div class="sysinfo-value mono">${info.os.kernel}</div>
          </div>
          <div class="sysinfo-item">
            <div class="sysinfo-label">Architecture</div>
            <div class="sysinfo-value">${info.os.arch}</div>
          </div>
          <div class="sysinfo-item">
            <div class="sysinfo-label">Hostname</div>
            <div class="sysinfo-value mono">${info.os.hostname}</div>
          </div>
          <div class="sysinfo-item">
            <div class="sysinfo-label">Platform</div>
            <div class="sysinfo-value">${info.os.platform}</div>
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Failed to fetch system info:', error);
    sysinfoBody.innerHTML = '<div class="sysinfo-loading">Failed to load system information</div>';
  }
}

function closeSysinfo() {
  sysinfoOverlay.classList.remove('active');
}

sysinfoBtn.addEventListener('click', openSysinfo);
sysinfoClose.addEventListener('click', closeSysinfo);
sysinfoOverlay.addEventListener('click', (e) => {
  if (e.target === sysinfoOverlay) closeSysinfo();
});

// Pause/Resume toggle
const pauseBtn = document.getElementById('pause-btn');
const pauseIcon = pauseBtn.querySelector('.pause-icon');
const playIcon = pauseBtn.querySelector('.play-icon');
let isPaused = false;

function togglePause() {
  isPaused = !isPaused;
  pauseIcon.style.display = isPaused ? 'none' : 'block';
  playIcon.style.display = isPaused ? 'block' : 'none';
  pauseBtn.classList.toggle('paused', isPaused);

  const statusIndicator = document.querySelector('.status-indicator');
  const statusText = statusIndicator.querySelector('.status-text');

  if (isPaused) {
    clearInterval(updateIntervalId);
    statusIndicator.classList.add('paused');
    statusText.textContent = 'Paused';
    showToast('info', 'Paused', 'Auto-refresh paused. Press P to resume.');
  } else {
    updateIntervalId = setInterval(updateDashboard, UPDATE_INTERVAL);
    statusIndicator.classList.remove('paused');
    statusText.textContent = 'Live';
    updateDashboard(); // Immediate refresh when resuming
    showToast('success', 'Resumed', 'Auto-refresh resumed');
  }
}

pauseBtn.addEventListener('click', togglePause);

// Fullscreen toggle
const fullscreenBtn = document.getElementById('fullscreen-btn');
const expandIcon = fullscreenBtn.querySelector('.fullscreen-expand');
const collapseIcon = fullscreenBtn.querySelector('.fullscreen-collapse');

function updateFullscreenIcon() {
  const isFullscreen = !!document.fullscreenElement;
  expandIcon.style.display = isFullscreen ? 'none' : 'block';
  collapseIcon.style.display = isFullscreen ? 'block' : 'none';
  fullscreenBtn.classList.toggle('active', isFullscreen);
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      showToast('error', 'Fullscreen Failed', 'Could not enter fullscreen mode');
    });
  } else {
    document.exitFullscreen();
  }
}

fullscreenBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', updateFullscreenIcon);

// Keyboard shortcuts
const KEYBOARD_SHORTCUTS = {
  r: () => document.getElementById('refresh-btn').click(),
  a: openApiModal, s: openSettings, f: toggleFullscreen,
  p: togglePause, i: openSysinfo, m: toggleSound, k: toggleCompactMode,
  '?': () => showToast('info', 'Keyboard Shortcuts', 'P: Pause | R: Refresh | A: API | K: Compact | M: Mute | S: Settings | I: Info | F: Fullscreen', 5000)
};

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (settingsOverlay.classList.contains('active') || apiOverlay.classList.contains('active')) return;
  const handler = KEYBOARD_SHORTCUTS[e.key.toLowerCase()];
  if (handler) handler();
});

// =====================
// Services Config Panel
// =====================

const servicesConfigOverlay = document.getElementById('services-config-overlay');
const servicesEditBtn = document.getElementById('services-edit-btn');
const servicesConfigClose = document.getElementById('services-config-close');
const servicesConfigCancel = document.getElementById('services-config-cancel');
const servicesConfigSave = document.getElementById('services-config-save');
const servicesConfigList = document.getElementById('services-config-list');
const servicesDiscoveredList = document.getElementById('services-discovered-list');
const servicesDiscoveredCount = document.getElementById('services-discovered-count');

// Local copy of services config
let servicesConfig = [];
let servicesConfigLoading = false;
let servicesRequiresAuth = false;
let discoveredServices = [];

// XSS Protection - escape HTML entities
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Set loading state on save button
function setServicesLoading(loading) {
  servicesConfigLoading = loading;
  servicesConfigSave.disabled = loading;
  servicesConfigSave.textContent = loading ? 'Saving...' : 'Save Changes';
}

// Discover and display available services
async function loadDiscoveredServices() {
  servicesDiscoveredList.innerHTML = '<div class="loading-services">Scanning...</div>';
  
  try {
    const response = await fetch(`${API_URL}/services/discover`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    discoveredServices = data.discovered || [];
    
    // Filter to only show services not already configured
    const configuredPorts = new Set(servicesConfig.map(s => s.port));
    const newServices = discoveredServices.filter(s => !configuredPorts.has(s.port));
    
    renderDiscoveredServices(newServices);
  } catch (error) {
    console.error('Service discovery failed:', error);
    servicesDiscoveredList.innerHTML = '<div class="no-services">Could not scan services</div>';
  }
}

// Render discovered services
function renderDiscoveredServices(services) {
  if (services.length === 0) {
    servicesDiscoveredCount.textContent = '';
    servicesDiscoveredList.innerHTML = '<div class="no-services">All detected services are already monitored</div>';
    return;
  }

  servicesDiscoveredCount.textContent = `${services.length} available`;
  servicesDiscoveredList.innerHTML = services.map(service => `
    <div class="discovered-service-item">
      <div class="discovered-service-icon"><svg><use href="#icon-${service.icon || 'server'}"/></svg></div>
      <div class="discovered-service-info">
        <div class="discovered-service-name">${escapeHtml(service.name)}</div>
        <div class="discovered-service-port">:${service.port}</div>
      </div>
      <button class="discovered-service-add" data-port="${service.port}">+ Add</button>
    </div>
  `).join('');

  // Add click handlers
  servicesDiscoveredList.querySelectorAll('.discovered-service-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const port = parseInt(btn.dataset.port, 10);
      const service = services.find(s => s.port === port);
      if (service) {
        addDiscoveredService(service);
        btn.disabled = true;
        btn.textContent = 'Added';
        renderServicesConfig();
      }
    });
  });
}

// Add a discovered service to config
function addDiscoveredService(service) {
  servicesConfig.push({
    name: service.name,
    port: service.port,
    path: service.path || '/',
    host: service.host || 'localhost',
    icon: service.icon || 'server',
    checkType: service.checkType || 'http',
    enabled: true
  });
  renderServicesConfig();
  showToast('success', 'Added', `${service.name} added to config`);
}

// Load services config from API
async function loadServicesConfig() {
  servicesConfigList.innerHTML = '<div class="no-services-config">Loading...</div>';
  
  try {
    const response = await fetch(`${API_URL}/services/config`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    servicesConfig = data.services || [];
    servicesRequiresAuth = data.requiresAuth || false;
    renderServicesConfig();
  } catch (error) {
    console.error('Failed to load services config:', error);
    servicesConfig = [];
    servicesConfigList.innerHTML = '<div class="no-services-config">Failed to load services. Check console.</div>';
    showToast('error', 'Load Failed', 'Could not load services configuration');
  }
}

// Render services config list
function renderServicesConfig() {
  if (servicesConfig.length === 0) {
    servicesConfigList.innerHTML = '<div class="no-services-config">No services configured. Add one below!</div>';
    return;
  }

  servicesConfigList.innerHTML = servicesConfig.map((service, index) => `
    <div class="service-config-item ${service.enabled === false ? 'disabled' : ''}" data-index="${index}">
      <label class="service-config-toggle">
        <input type="checkbox" ${service.enabled !== false ? 'checked' : ''} data-index="${index}">
        <span class="toggle-slider"></span>
      </label>
      <div class="service-config-info">
        <div class="service-config-name" data-index="${index}">
          <span class="service-name-text">${escapeHtml(service.name)}</span>
          <input type="text" class="service-name-input" value="${escapeHtml(service.name)}" data-index="${index}" style="display:none">
        </div>
        <div class="service-config-details">${escapeHtml(service.host || 'localhost')}:${service.port}${service.path && service.path !== '/' && !service.path.includes('/api/') ? escapeHtml(service.path) : ''}</div>
      </div>
      <button class="service-config-edit" data-index="${index}" title="Rename service"><svg><use href="#icon-edit"/></svg></button>
      <button class="service-config-delete" data-index="${index}" title="Delete service"><svg><use href="#icon-trash"/></svg></button>
    </div>
  `).join('');

  // Add event listeners for toggles
  servicesConfigList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.index, 10);
      servicesConfig[index].enabled = e.target.checked;
      e.target.closest('.service-config-item').classList.toggle('disabled', !e.target.checked);
    });
  });

  // Add event listeners for delete buttons
  servicesConfigList.querySelectorAll('.service-config-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.currentTarget.dataset.index, 10);
      servicesConfig.splice(index, 1);
      renderServicesConfig();
    });
  });

  // Add event listeners for edit buttons
  servicesConfigList.querySelectorAll('.service-config-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.currentTarget.dataset.index, 10);
      const item = e.currentTarget.closest('.service-config-item');
      const nameText = item.querySelector('.service-name-text');
      const nameInput = item.querySelector('.service-name-input');
      nameText.style.display = 'none';
      nameInput.style.display = 'block';
      nameInput.focus();
      nameInput.select();
    });
  });

  // Add event listeners for name inputs
  servicesConfigList.querySelectorAll('.service-name-input').forEach(input => {
    const saveRename = (e) => {
      const index = parseInt(e.target.dataset.index, 10);
      const newName = e.target.value.trim();
      const item = e.target.closest('.service-config-item');
      const nameText = item.querySelector('.service-name-text');
      if (newName && newName !== servicesConfig[index].name) {
        servicesConfig[index].name = newName;
        nameText.textContent = newName;
      }
      e.target.style.display = 'none';
      nameText.style.display = 'inline';
    };
    input.addEventListener('blur', saveRename);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveRename(e); }
      else if (e.key === 'Escape') {
        const item = e.target.closest('.service-config-item');
        e.target.value = item.querySelector('.service-name-text').textContent;
        e.target.style.display = 'none';
        item.querySelector('.service-name-text').style.display = 'inline';
      }
    });
  });
}

// Open services config panel
async function openServicesConfig() {
  servicesConfigOverlay.classList.add('active');
  await loadServicesConfig();
  loadDiscoveredServices();
}

// Close services config panel
function closeServicesConfig() {
  servicesConfigOverlay.classList.remove('active');
  setServicesLoading(false);
}

// Save services config to API
async function saveServicesConfig() {
  if (servicesConfigLoading) return;
  
  setServicesLoading(true);
  
  try {
    const response = await fetch(`${API_URL}/services/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ services: servicesConfig })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    showToast('success', 'Services Saved', 'Configuration updated successfully');
    closeServicesConfig();
    // Refresh the services display
    updateServices();
  } catch (error) {
    console.error('Failed to save services config:', error);
    showToast('error', 'Save Failed', error.message || 'Could not save services configuration');
  } finally {
    setServicesLoading(false);
  }
}

// Event listeners
servicesEditBtn.addEventListener('click', openServicesConfig);
servicesConfigClose.addEventListener('click', closeServicesConfig);
servicesConfigCancel.addEventListener('click', closeServicesConfig);
servicesConfigSave.addEventListener('click', saveServicesConfig);

// Close on overlay click
servicesConfigOverlay.addEventListener('click', (e) => {
  if (e.target === servicesConfigOverlay) {
    closeServicesConfig();
  }
});


// ===================
// WireGuard Section
// ===================

const wireguardSection = document.getElementById('wireguard-section');
const wireguardGrid = document.getElementById('wireguard-grid');
const wireguardCount = document.getElementById('wireguard-count');
const wireguardEnabledToggle = document.getElementById('setting-wireguard-enabled');
const wireguardInterfaceInput = document.getElementById('setting-wireguard-interface');
const wireguardInterfaceRow = document.getElementById('wireguard-interface-row');

let wireguardEnabled = false;
let wireguardInterface = 'wg0';
let wireguardUpdating = false;

// Load WireGuard settings
async function loadWireguardSettings() {
  try {
    const response = await fetch(`${API_URL}/settings/wireguard`);
    if (response.ok) {
      const data = await response.json();
      wireguardEnabled = data.enabled || false;
      wireguardInterface = data.interface || 'wg0';
      
      // Update UI
      if (wireguardEnabledToggle) {
        wireguardEnabledToggle.checked = wireguardEnabled;
      }
      if (wireguardInterfaceInput) {
        wireguardInterfaceInput.value = wireguardInterface;
      }
      if (wireguardInterfaceRow) {
        wireguardInterfaceRow.style.display = wireguardEnabled ? 'flex' : 'none';
      }
      
      // Show/hide section
      if (wireguardSection) {
        wireguardSection.style.display = wireguardEnabled ? 'block' : 'none';
      }
      
      // Fetch data if enabled
      if (wireguardEnabled) {
        updateWireguard();
      }
    }
  } catch (e) {
    console.error('Failed to load WireGuard settings:', e);
  }
}

// Save WireGuard settings
async function saveWireguardSettings(enabled, iface) {
  wireguardUpdating = true;
  try {
    const response = await fetch(`${API_URL}/settings/wireguard`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, interface: iface })
    });
    if (response.ok) {
      wireguardEnabled = enabled;
      wireguardInterface = iface;
      
      // Show/hide section
      if (wireguardSection) {
        wireguardSection.style.display = enabled ? 'block' : 'none';
      }
      
      if (enabled) {
        await updateWireguard();
      }
      
      showToast(enabled ? 'success' : 'info', 'WireGuard', enabled ? 'WireGuard monitoring enabled' : 'WireGuard monitoring disabled');
    }
  } catch (e) {
    console.error('Failed to save WireGuard settings:', e);
    showToast('error', 'Error', 'Failed to save WireGuard settings');
  } finally {
    wireguardUpdating = false;
  }
}

// Create WireGuard client cards
function renderWireguardClients(data) {
  if (!data || !data.enabled) {
    wireguardSection.style.display = 'none';
    return;
  }

  wireguardSection.style.display = 'block';

  if (!data.clients || data.clients.length === 0) {
    wireguardGrid.innerHTML = '<div class="no-wireguard">No WireGuard clients configured</div>';
    wireguardCount.textContent = '0 clients';
    return;
  }

  const onlineCount = data.clients.filter(c => c.online).length;
  wireguardCount.textContent = `${onlineCount} online`;

  wireguardGrid.innerHTML = data.clients.map(client => `
    <div class="wireguard-card ${client.online ? 'online' : 'offline'}">
      <div class="wireguard-header">
        <div class="wireguard-client-name">
          <span class="wireguard-status-dot ${client.online ? 'online' : 'offline'}"></span>
          <span class="wireguard-name">${escapeHtml(client.name)}</span>
        </div>
        <span class="wireguard-last-seen">${escapeHtml(client.lastHandshakeAgo)}</span>
      </div>
      <div class="wireguard-details">
        ${client.endpoint ? `
          <div class="wireguard-endpoint"><svg><use href="#icon-globe"/></svg>${escapeHtml(client.endpoint)}</div>
        ` : `
          <div class="wireguard-endpoint none"><svg><use href="#icon-no-connection"/></svg>No connection</div>
        `}
        <div class="wireguard-transfer">
          <div class="wireguard-transfer-stat">
            <div class="wireguard-transfer-label rx"><svg><use href="#icon-arrow-down"/></svg>RX</div>
            <div class="wireguard-transfer-value rx">${formatBytes(client.transfer.received)}</div>
          </div>
          <div class="wireguard-transfer-stat">
            <div class="wireguard-transfer-label tx"><svg><use href="#icon-arrow-up"/></svg>TX</div>
            <div class="wireguard-transfer-value tx">${formatBytes(client.transfer.sent)}</div>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

// Fetch and update WireGuard data
async function updateWireguard() {
  if (!wireguardEnabled) return;
  
  try {
    const response = await fetch(`${API_URL}/wireguard`);
    if (response.ok) {
      const data = await response.json();
      renderWireguardClients(data);
    } else if (response.status === 503) {
      // WireGuard disabled in settings
      wireguardSection.style.display = 'none';
    } else {
      console.error('WireGuard API error:', response.status);
    }
  } catch (e) {
    console.error('Failed to fetch WireGuard data:', e);
    wireguardGrid.innerHTML = '<div class="no-wireguard">Failed to load WireGuard data</div>';
  }
}

// WireGuard toggle handler
if (wireguardEnabledToggle) {
  wireguardEnabledToggle.addEventListener('change', () => {
    const enabled = wireguardEnabledToggle.checked;
    const iface = wireguardInterfaceInput?.value || 'wg0';
    
    // Show/hide interface input
    if (wireguardInterfaceRow) {
      wireguardInterfaceRow.style.display = enabled ? 'flex' : 'none';
    }
    
    saveWireguardSettings(enabled, iface);
  });
}

// WireGuard interface input handler
if (wireguardInterfaceInput) {
  wireguardInterfaceInput.addEventListener('change', () => {
    if (wireguardEnabled) {
      saveWireguardSettings(true, wireguardInterfaceInput.value);
    }
  });
}

// Load WireGuard settings on init
loadWireguardSettings();

// Update WireGuard every 10 seconds (same as services)
setInterval(() => {
  if (wireguardEnabled && !wireguardUpdating) {
    updateWireguard();
  }
}, 10000);

// End of file
