// Admin token prompt, shown when a config write answers 401 (ADMIN_TOKEN set server-side).
import { byId, setText } from '../dom.js';
import { setTokenPrompt } from '../api.js';
import { openDialog } from './dialog.js';

const HELP =
  'This dashboard is protected by ADMIN_TOKEN. Enter it to change the configuration. It is stored in this browser only.';

export function promptToken({ rejected = false } = {}) {
  const dialog = byId('dlg-auth');
  const input = byId('auth-token');
  if (dialog.open) return Promise.resolve(null);
  setText(byId('auth-help'), rejected ? 'That token was rejected. Check ADMIN_TOKEN and try again.' : HELP);
  input.value = '';
  dialog.returnValue = '';
  openDialog('dlg-auth');
  input.focus();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? input.value.trim() : null), { once: true });
  });
}

export function initAuth() {
  byId('auth-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (byId('auth-token').value.trim()) byId('dlg-auth').close('ok');
  });
  setTokenPrompt(promptToken);
}
