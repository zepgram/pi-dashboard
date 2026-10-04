import fs from 'node:fs';
import { execFile } from 'node:child_process';

export function readText(file) {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

export function readInt(file) {
  const text = readText(file);
  if (text === null) return null;
  const n = Number.parseInt(text.trim(), 10);
  return Number.isNaN(n) ? null : n;
}

/** Resolves with stdout, or null on any failure (missing binary, timeout, non-zero exit). */
export function run(cmd, args, { timeout = 5000 } = {}) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

export const round1 = n => Math.round(n * 10) / 10;
export const round2 = n => Math.round(n * 100) / 100;

/** Caches an async producer for `ttlMs`; concurrent callers share one in-flight call. */
export function cached(ttlMs, producer) {
  let value;
  let at = 0;
  let pending = null;
  return async function get() {
    if (at && Date.now() - at < ttlMs) return value;
    if (!pending) {
      pending = Promise.resolve()
        .then(producer)
        .then(v => {
          value = v;
          at = Date.now();
          return v;
        })
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  };
}
