import { anyDialogOpen } from './modals/dialog.js';

export function initShortcuts(shortcuts) {
  const byKey = new Map();
  for (const shortcut of shortcuts) for (const key of shortcut.keys) byKey.set(key.toLowerCase(), shortcut.run);

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
    // Esc is handled natively by <dialog>; other shortcuts are inert under a modal.
    if (anyDialogOpen()) return;
    const run = byKey.get(event.key.toLowerCase());
    if (!run) return;
    event.preventDefault();
    run();
  });
}
