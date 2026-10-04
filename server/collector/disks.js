import fs from 'node:fs';
import { readText, round1 } from '../util.js';

const MIN_SIZE = 100 * 1024 * 1024;
const SKIP_FSTYPE = new Set(['squashfs', 'iso9660', 'overlay', 'tmpfs', 'devtmpfs']);

/** Real block-device mounts from a mounts table, first mount point per device. */
export function parseMounts(text) {
  const mounts = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    const [device, rawMount, fstype] = line.split(' ');
    if (!device?.startsWith('/dev/') || !rawMount) continue;
    // The kernel escapes spaces and friends as octal sequences.
    const mount = rawMount.replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(Number.parseInt(oct, 8)));
    if (device.includes('loop') || SKIP_FSTYPE.has(fstype) || mount.startsWith('/boot')) continue;
    if (seen.has(device)) continue;
    seen.add(device);
    mounts.push({ fs: device, mount });
  }
  return mounts;
}

export async function readDisks({ procRoot, hostRoot }) {
  const table = readText(`${procRoot}/1/mounts`) ?? readText(`${procRoot}/mounts`) ?? '';
  const disks = [];
  const rootDev = await fs.promises.stat(`${hostRoot}/`).then(st => st.dev, () => null);
  for (const { fs: device, mount } of parseMounts(table)) {
    try {
      const target = `${hostRoot}${mount}`;
      // A host mount that is not visible from here would report its parent filesystem.
      if (mount !== '/' && (await fs.promises.stat(target)).dev === rootDev) continue;
      const st = await fs.promises.statfs(target);
      const size = st.blocks * st.bsize;
      if (size < MIN_SIZE) continue;
      const used = (st.blocks - st.bfree) * st.bsize;
      const available = st.bavail * st.bsize;
      // Same definition as df: share of the space a regular user can fill.
      const percent = used + available > 0 ? round1((used / (used + available)) * 100) : 0;
      disks.push({ fs: device, mount, size, used, available, percent });
    } catch {
      // Mounted on the host after the container started, or not reachable from here.
    }
  }
  return disks;
}
