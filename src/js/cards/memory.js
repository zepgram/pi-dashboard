import { byId, setAttr, setText, setWidth, show } from '../dom.js';
import { on } from '../bus.js';
import { bytes, clamp, isNum, percent } from '../format.js';
import { levelFor } from '../state.js';
import { liveChart, readout, thresholdLines } from './metric.js';

// `used` excludes reclaimable cache; `available` is what applications can still
// claim (free + reclaimable). Cache is clamped so the bar never exceeds the total.
export function memoryBreakdown(memory) {
  const total = isNum(memory?.total) && memory.total > 0 ? memory.total : 0;
  const used = clamp(isNum(memory?.used) ? memory.used : 0, 0, total);
  const cache = clamp(isNum(memory?.buffcache) ? memory.buffcache : 0, 0, total - used);
  const available = clamp(isNum(memory?.available) ? memory.available : total - used, 0, total);
  return { total, used, cache, available };
}

export function initMemory() {
  const card = byId('card-memory');
  const draw = liveChart('chart-memory', { min: 0, max: 100 });

  on('stats', (stats) => {
    const memory = stats.memory || {};
    const { total, used, cache, available } = memoryBreakdown(memory);
    const pct = isNum(memory.percent) ? memory.percent : total ? (used / total) * 100 : null;

    setText(byId('mem-value'), percent(pct));
    setAttr(card, 'data-level', levelFor('memory', pct));

    const summary = byId('mem-summary');
    show(summary, total > 0);
    setText(summary, `${bytes(used)} / ${bytes(total)}`);

    setWidth(byId('mem-bar-used'), total ? (used / total) * 100 : 0);
    setWidth(byId('mem-bar-cache'), total ? (cache / total) * 100 : 0);
    setAttr(byId('mem-bar'), 'aria-label', `Memory: ${bytes(used)} used, ${bytes(cache)} cache, ${bytes(available)} available`);
    setText(byId('mem-used'), bytes(used));
    setText(byId('mem-cache'), bytes(cache));
    setText(byId('mem-free'), bytes(available));

    draw([{ key: 'memory', color: '--accent-2' }], stats._time, thresholdLines('memory'));
    readout(byId('mem-readout'), 'memory', stats._time, (v) => `${percent(v)}%`);
  });
}
