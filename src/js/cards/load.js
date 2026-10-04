import { byId, setAttr, setText, setWidth, show } from '../dom.js';
import { on } from '../bus.js';
import { dateTime, duration, fixed, isNum, uptimeParts } from '../format.js';
import { liveChart } from './metric.js';

export function initLoad() {
  const draw = liveChart('chart-load', { min: 0, max: null });

  on('stats', (stats) => {
    const load = stats.load || {};
    const coreCount = stats.cpu?.cores?.length || 1;
    const up = uptimeParts(load.uptime);
    setText(byId('up-d'), up.days);
    setText(byId('up-h'), String(up.hours).padStart(2, '0'));
    setText(byId('up-m'), String(up.minutes).padStart(2, '0'));
    setText(byId('strip-uptime'), duration(load.uptime));
    setText(byId('boot-time'), isNum(load.uptime) ? dateTime(Date.now() - load.uptime * 1000) : '--');

    const tag = byId('load-cores');
    show(tag, true);
    setText(tag, `${coreCount} ${coreCount === 1 ? 'core' : 'cores'}`);

    const avg = Array.isArray(load.loadAvg) ? load.loadAvg : [load.avgLoad];
    ['1', '5', '15'].forEach((name, i) => {
      const value = avg[i];
      setText(byId(`load-${name}`), fixed(value, 2));
      const bar = byId(`load-${name}-bar`);
      // A load equal to the core count means every core is busy.
      const ratio = isNum(value) ? value / coreCount : 0;
      setWidth(bar, ratio * 100);
      setAttr(bar, 'data-level', ratio >= 1.5 ? 'crit' : ratio >= 1 ? 'warn' : 'ok');
    });

    draw([{ key: 'load', color: '--accent' }], stats._time, [{ value: coreCount, color: '--warn', fit: false }]);
  });
}
