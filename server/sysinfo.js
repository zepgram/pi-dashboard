import si from 'systeminformation';
import { cached } from './util.js';

function memoryTypeFor(model) {
  const m = model.toLowerCase();
  if (m.includes('pi 5')) return 'LPDDR4X';
  if (m.includes('pi 4')) return 'LPDDR4';
  if (m.includes('pi')) return 'LPDDR2';
  return null;
}

/** Hardware identity: static, so one probe every ten minutes is plenty. */
export function createSystemInfoReader(readOsInfo) {
  return cached(600_000, async () => {
    const [cpu, system, mem, osInfo, baseboard, hostOs] = await Promise.all([
      si.cpu(),
      si.system(),
      si.mem(),
      si.osInfo(),
      si.baseboard(),
      readOsInfo(),
    ]);
    // Inside a container the DMI "system" is the container; the baseboard is the real board.
    const board = `${baseboard.model || ''} ${baseboard.version || ''}`.trim();
    const model = !system.model || system.model === 'Docker Container' ? board : system.model;
    const memType = mem.type && mem.type !== 'Unknown' ? mem.type : memoryTypeFor(board);
    return {
      cpu: {
        manufacturer: cpu.manufacturer,
        brand: cpu.brand,
        speed: cpu.speed,
        speedMax: cpu.speedMax,
        cores: cpu.cores,
        physicalCores: cpu.physicalCores,
        processors: cpu.processors,
      },
      system: {
        manufacturer: system.manufacturer || baseboard.manufacturer || '',
        model,
        version: system.version || baseboard.version || '',
        serial: system.serial,
        uuid: system.uuid,
      },
      memory: { total: mem.total, type: memType || 'Unknown', formFactor: mem.formFactor || 'SODIMM' },
      os: {
        platform: hostOs.platform,
        distro: hostOs.distro,
        version: hostOs.version,
        release: hostOs.release,
        codename: hostOs.codename,
        kernel: osInfo.kernel,
        arch: hostOs.arch,
        hostname: hostOs.hostname,
        fqdn: osInfo.fqdn && !/^[0-9a-f]{12}$/.test(osInfo.fqdn) ? osInfo.fqdn : hostOs.hostname,
        updatesAvailable: hostOs.updatesAvailable,
      },
      baseboard: { manufacturer: baseboard.manufacturer, model: baseboard.model, version: baseboard.version },
    };
  });
}
