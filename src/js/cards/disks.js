import { byId, el, setAttr, setText, setWidth, show, syncList } from '../dom.js';
import { on } from '../bus.js';
import { bytes, percent } from '../format.js';
import { levelFor } from '../state.js';

export function initDisks() {
  const host = byId('disks');

  on('stats', (stats) => {
    const disks = Array.isArray(stats.disks) ? stats.disks : [];
    show(byId('disks-empty'), disks.length === 0);
    const count = byId('disks-count');
    show(count, disks.length > 0);
    setText(count, `${disks.length} ${disks.length === 1 ? 'volume' : 'volumes'}`);

    syncList(
      host,
      disks,
      (disk) => `${disk.fs}|${disk.mount}`,
      () =>
        el(
          'div',
          { class: 'disk' },
          el('div', { class: 'disk-head' }, el('span', { class: 'disk-mount' }), el('span', { class: 'disk-pct' })),
          el('div', { class: 'seg-bar', role: 'img' }, el('i')),
          el('div', { class: 'disk-foot' }, el('span', { class: 'disk-fs' }), el('span', { class: 'disk-size' }))
        ),
      (row, disk) => {
        const [head, bar, foot] = row.children;
        setAttr(row, 'data-level', levelFor('disk', disk.percent));
        setText(head.children[0], disk.mount);
        setText(head.children[1], `${percent(disk.percent, 0)}%`);
        setWidth(bar.firstChild, disk.percent);
        setAttr(bar, 'aria-label', `${disk.mount} ${percent(disk.percent, 0)}% used`);
        setText(foot.children[0], disk.fs || '');
        setText(foot.children[1], `${bytes(disk.used)} used · ${bytes(disk.available)} free · ${bytes(disk.size)}`);
      }
    );
  });
}
