import { byId, el, setAttr, setText, setWidth, show, syncList } from '../dom.js';
import { on } from '../bus.js';
import { isNum, percent } from '../format.js';
import { levelFor, state } from '../state.js';
import { liveChart, readout, thresholdLines } from './metric.js';

export function initCpu() {
  const card = byId('card-cpu');
  const cores = byId('cpu-cores');
  const draw = liveChart('chart-cpu', { min: 0, max: 100 });

  on('stats', (stats) => {
    const cpu = stats.cpu || {};
    setText(byId('cpu-value'), percent(cpu.usage));
    setAttr(card, 'data-level', levelFor('cpu', cpu.usage));

    const speed = byId('cpu-speed');
    show(speed, isNum(cpu.speed) && cpu.speed > 0);
    if (isNum(cpu.speed)) setText(speed, `${cpu.speed.toFixed(2)} GHz`);
    show(byId('cpu-oc'), Boolean(cpu.overclocked) && cpu.speed > state.settings.overclockBase);

    const list = Array.isArray(cpu.cores) ? cpu.cores : [];
    cores.classList.toggle('cores-many', list.length > 8);
    syncList(
      cores,
      list,
      (_, i) => i,
      (_, i) =>
        el(
          'div',
          { class: 'core' },
          el('span', { class: 'core-id', text: `C${i}` }),
          el('span', { class: 'bar' }, el('i')),
          el('span', { class: 'core-val' })
        ),
      (row, load) => {
        setWidth(row.children[1].firstChild, load);
        setText(row.children[2], percent(load, 0));
        setAttr(row, 'data-level', levelFor('cpu', load));
      }
    );

    draw([{ key: 'cpu', color: '--accent' }], stats._time, thresholdLines('cpu'));
    readout(byId('cpu-readout'), 'cpu', stats._time, (v) => `${percent(v)}%`);
  });
}
