import { $, byId, setAttr, setText, show } from '../dom.js';
import { on } from '../bus.js';
import { fixed, isNum } from '../format.js';
import { levelFor, state } from '../state.js';
import { liveChart, readout, thresholdLines } from './metric.js';

const LEVEL_COLOR = { ok: '--ok', warn: '--warn', crit: '--crit' };

function statusLabel(temp, level) {
  if (level === 'crit') return 'Critical';
  if (level === 'warn') return 'Hot';
  return temp >= state.settings.thresholds.temperature.warning - 15 ? 'Warm' : 'Normal';
}

export function initTemperature() {
  const card = byId('card-temp');
  const draw = liveChart('chart-temperature', { min: 20, max: 90 });
  let sessionMin = null;
  let sessionMax = null;

  on('stats', (stats) => {
    const info = stats.temperature || {};
    const temp = info.main;
    const hasSensor = isNum(temp) && temp > 0;

    card.classList.toggle('no-sensor', !hasSensor);
    show(byId('temp-empty'), !hasSensor);
    show(byId('temp-status'), hasSensor);
    setText(byId('temp-value'), hasSensor ? fixed(temp) : '--');

    const level = hasSensor ? levelFor('temperature', temp) : 'ok';
    setAttr(card, 'data-level', level);

    if (hasSensor) {
      sessionMin = sessionMin == null ? temp : Math.min(sessionMin, temp);
      sessionMax = sessionMax == null ? temp : Math.max(sessionMax, temp);
      setText(byId('temp-min'), `${fixed(sessionMin)}°C`);
      setText(byId('temp-max'), `${fixed(sessionMax)}°C`);
      const status = byId('temp-status');
      setText(status, statusLabel(temp, level));
      setAttr(status, 'data-level', level);
    }

    const throttle = byId('temp-throttle');
    const text = $('#temp-throttle-text', throttle);
    show(throttle, info.throttled !== undefined);
    if (info.throttled) {
      const reasons = (info.reasons || []).filter((reason) => !String(reason).includes('occurred'));
      setText(text, reasons.join(', ') || 'Throttled');
      setAttr(throttle, 'data-level', 'crit');
    } else if (info.flags > 0) {
      setText(text, 'Throttled earlier');
      setAttr(throttle, 'data-level', 'warn');
    } else {
      setText(text, 'No throttling');
      setAttr(throttle, 'data-level', 'ok');
    }

    draw([{ key: 'temperature', color: LEVEL_COLOR[level] }], stats._time, hasSensor ? thresholdLines('temperature') : []);
    readout(byId('temp-readout'), 'temperature', stats._time, (v) => `${fixed(v)}°C`);
  });
}
