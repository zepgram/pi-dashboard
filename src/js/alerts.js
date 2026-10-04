// Threshold alerts: a toast (and optional beep) only when a metric changes level.
import { on } from './bus.js';
import { effective, levelFor } from './state.js';
import { toast } from './toast.js';
import { isNum } from './format.js';

const levels = new Map();
let audio = null;

function beep(critical) {
  if (!effective('sound')) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    const play = (at, freq, length, gainValue) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.frequency.value = freq;
      gain.gain.value = gainValue;
      osc.start(audio.currentTime + at);
      osc.stop(audio.currentTime + at + length);
    };
    if (critical) {
      play(0, 440, 0.1, 0.3);
      play(0.15, 440, 0.1, 0.3);
    } else {
      play(0, 660, 0.08, 0.2);
    }
  } catch {
    /* audio unavailable or blocked until a user gesture */
  }
}

function check(stats) {
  const checks = [
    { key: 'cpu', th: 'cpu', label: 'CPU', value: stats.cpu?.usage, unit: '%' },
    { key: 'memory', th: 'memory', label: 'Memory', value: stats.memory?.percent, unit: '%' },
    { key: 'temperature', th: 'temperature', label: 'Temperature', value: stats.temperature?.main, unit: '°C' },
    ...(stats.disks || []).map((disk) => ({
      key: `disk:${disk.mount}`,
      th: 'disk',
      label: `Disk ${disk.mount}`,
      value: disk.percent,
      unit: '%'
    }))
  ];

  let worst = null;
  for (const item of checks) {
    if (!isNum(item.value) || (item.th === 'temperature' && item.value <= 0)) continue;
    const level = levelFor(item.th, item.value);
    const previous = levels.get(item.key) || 'ok';
    levels.set(item.key, level);
    if (level === previous || level === 'ok') continue;
    // Dropping from critical back to warning is good news, not a new alert.
    if (previous === 'crit' && level === 'warn') continue;
    toast(level, `${item.label} ${level === 'crit' ? 'critical' : 'warning'}`, `${item.label} at ${item.value}${item.unit}`, 5000);
    if (level === 'crit' || !worst) worst = level;
  }
  if (worst) beep(worst === 'crit');
}

export function initAlerts() {
  on('stats', check);
}

