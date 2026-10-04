// Modals are native <dialog> elements: showModal() provides the focus trap,
// Esc handling, inert background and focus restoration.
import { $$, byId } from '../dom.js';

const STACKABLE = 'dlg-auth';

export function openDialog(id) {
  const dialog = byId(id);
  if (id !== STACKABLE) {
    for (const other of $$('dialog[open]')) if (other !== dialog) other.close();
  }
  if (!dialog.open) {
    dialog.showModal();
    // Start focus on the dialog itself rather than on its first button.
    dialog.focus();
  }
  return dialog;
}

export const anyDialogOpen = () => Boolean(document.querySelector('dialog[open]'));

export function initDialogs() {
  for (const dialog of $$('dialog.modal')) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog || event.target.closest('[data-close]')) dialog.close();
    });
    // Toasts are re-parented into the open dialog; give them back on close.
    dialog.addEventListener('close', () => {
      const toasts = byId('toasts');
      if (dialog.contains(toasts)) (document.querySelector('dialog[open]') || document.body).append(toasts);
    });
  }
}
