import { byId, el } from '../dom.js';
import { api } from '../api.js';
import { bytes } from '../format.js';
import { openDialog } from './dialog.js';

const join = (...parts) => parts.filter(Boolean).join(' ') || 'Unknown';

function sections(info) {
  const { cpu = {}, memory = {}, system = {}, baseboard = {}, os = {} } = info;
  const updates = Number(os.updatesAvailable) || 0;
  return [
    ['Processor', [
      ['Model', join(cpu.manufacturer, cpu.brand)],
      ['Cores', cpu.cores ? `${cpu.cores} (${cpu.physicalCores ?? cpu.cores} physical)` : 'Unknown'],
      ['Speed', cpu.speed ? `${cpu.speed} GHz${cpu.speedMax ? ` (max ${cpu.speedMax} GHz)` : ''}` : 'Unknown']
    ]],
    ['Memory', [
      ['Total', bytes(memory.total, 2)],
      ['Type', memory.type || 'Unknown']
    ]],
    ['System', [
      ['Manufacturer', system.manufacturer || 'Unknown'],
      ['Model', system.model || 'Unknown'],
      ['Board', join(baseboard.manufacturer, baseboard.model)],
      ['Revision', baseboard.version || 'n/a']
    ]],
    ['Operating system', [
      ['Distribution', os.distro || 'Unknown'],
      ['Version', os.version || os.release || 'Unknown'],
      ['Kernel', os.kernel || 'Unknown'],
      ['Architecture', os.arch || 'Unknown'],
      ['Hostname', os.hostname || 'Unknown'],
      ['Platform', os.platform || 'Unknown'],
      ['Updates', updates > 0 ? `${updates} available` : 'Up to date', updates > 0 ? 'warn' : 'ok']
    ]]
  ];
}

export async function openSysinfo() {
  const body = byId('sysinfo-body');
  body.replaceChildren(el('p', { class: 'empty', text: 'Loading system information…' }));
  openDialog('dlg-sysinfo');
  try {
    const info = await api.get('/api/sysinfo', { timeout: 20000 });
    body.replaceChildren(
      ...sections(info).map(([title, rows]) =>
        el(
          'section',
          { class: 'group' },
          el('h3', { class: 'group-title', text: title }),
          el(
            'dl',
            { class: 'facts' },
            rows.map(([key, value, level]) =>
              el('div', {}, el('dt', { text: key }), el('dd', { text: value, dataset: level ? { level } : {} }))
            )
          )
        )
      )
    );
  } catch (error) {
    body.replaceChildren(el('p', { class: 'empty', text: `Could not load system information (${error.message})` }));
  }
}

export function initSysinfo() {
  byId('btn-sysinfo').addEventListener('click', openSysinfo);
}
