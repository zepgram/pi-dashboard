import { byId, el, setAttr, setText, setWidth, show, syncList } from '../dom.js';
import { on } from '../bus.js';
import { isNum } from '../format.js';

export function initProcesses() {
  const body = byId('processes');

  on('stats', (stats) => {
    const processes = Array.isArray(stats.processes) ? stats.processes : [];
    show(byId('processes-empty'), processes.length === 0);
    show(body.closest('.table-wrap'), processes.length > 0);

    syncList(
      body,
      processes,
      (p) => p.pid,
      () =>
        el(
          'tr',
          {},
          el('td', { class: 'cell-main' }),
          el('td', { class: 'mono dim col-cmd' }),
          el('td', { class: 'r' }, el('span', { class: 'meter' }, el('span', { class: 'bar' }, el('i')), el('span', { class: 'mono' }))),
          el('td', { class: 'r mono' }),
          el('td', { class: 'r mono dim col-time' }),
          el('td', { class: 'r mono dim col-pid' })
        ),
      (row, p) => {
        const [name, cmd, cpu, mem, time, pid] = row.children;
        const command = p.cmd || p.name || '';
        setText(name, p.name);
        setAttr(name, 'title', p.name || '');
        setText(cmd, command);
        setAttr(cmd, 'title', command);
        // Per-process CPU is relative to one core and can exceed 100%.
        setWidth(cpu.firstChild.firstChild.firstChild, p.cpu);
        setText(cpu.firstChild.lastChild, isNum(p.cpu) ? `${p.cpu.toFixed(1)}%` : '--');
        setText(mem, isNum(p.mem) ? `${p.mem.toFixed(1)}%` : '--');
        setText(time, p.time || '--');
        setText(pid, p.pid);
      }
    );
  });
}
