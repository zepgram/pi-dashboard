import { byId, el } from '../dom.js';
import { openDialog } from './dialog.js';

export function initHelp(shortcuts) {
  const list = byId('help-keys');
  for (const { keys, label } of shortcuts) {
    list.append(
      el('div', {}, el('dt', {}, keys.map((key) => el('kbd', { text: key }))), el('dd', { text: label }))
    );
  }
  byId('btn-help').addEventListener('click', openHelp);
}

export const openHelp = () => openDialog('dlg-help');
