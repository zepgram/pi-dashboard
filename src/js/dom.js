export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const byId = (id) => document.getElementById(id);

const SVG_NS = 'http://www.w3.org/2000/svg';

// Element factory. Children are appended as nodes or text, never parsed as HTML.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node && key !== 'list' && key !== 'form') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child);
  }
  return node;
}

export function icon(name, className = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export function setText(node, value) {
  const text = value == null ? '' : String(value);
  if (node.textContent !== text) node.textContent = text;
}

export function setAttr(node, name, value) {
  if (node.getAttribute(name) !== String(value)) node.setAttribute(name, value);
}

export function setWidth(node, percent) {
  const width = `${Math.max(0, Math.min(100, Number(percent) || 0)).toFixed(1)}%`;
  if (node.style.width !== width) node.style.width = width;
}

export function show(node, visible) {
  if (node.hidden === visible) node.hidden = !visible;
}

// Keyed reconciliation: rows are created once, updated in place and only moved
// when their order changes, so hover, focus and scroll state survive each tick.
export function syncList(parent, items, keyOf, create, update) {
  const rows = parent._rows || (parent._rows = new Map());
  const seen = new Set();
  items.forEach((item, index) => {
    const key = String(keyOf(item, index));
    seen.add(key);
    let row = rows.get(key);
    if (!row) {
      row = create(item, index);
      rows.set(key, row);
    }
    update(row, item, index);
    if (parent.children[index] !== row) parent.insertBefore(row, parent.children[index] || null);
  });
  for (const [key, row] of rows) {
    if (!seen.has(key)) {
      row.remove();
      rows.delete(key);
    }
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API is unavailable on plain-HTTP LAN origins: fall back to execCommand.
    const area = el('textarea', { value: text, style: 'position:fixed;left:-9999px;top:0' });
    const host = document.querySelector('dialog[open]') || document.body;
    host.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
