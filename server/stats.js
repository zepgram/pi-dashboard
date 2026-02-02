import si from 'systeminformation';
import os from 'os';
import fs from 'fs';
import http from 'http';
import { execSync } from 'child_process';
import { KNOWN_SERVICES, KNOWN_PROCESSES } from './services-config.js';

// Get Raspberry Pi throttle status via vcgencmd
// Returns: { throttled: boolean, flags: number, reasons: string[] }
function getThrottleStatus() {
  try {
    const output = execSync('vcgencmd get_throttled 2>/dev/null', { encoding: 'utf-8', timeout: 1000 });
    const match = output.match(/throttled=(0x[0-9a-fA-F]+)/);
    if (match) {
      const flags = parseInt(match[1], 16);
      const reasons = [];
      // Current states
      if (flags & 0x1) reasons.push('Under-voltage');
      if (flags & 0x2) reasons.push('Freq capped');
      if (flags & 0x4) reasons.push('Throttled');
      if (flags & 0x8) reasons.push('Soft temp limit');
      // Historical (has occurred since boot)
      if (flags & 0x10000) reasons.push('Under-voltage occurred');
      if (flags & 0x20000) reasons.push('Freq cap occurred');
      if (flags & 0x40000) reasons.push('Throttling occurred');
      if (flags & 0x80000) reasons.push('Soft temp limit occurred');
      
      return {
        throttled: (flags & 0xF) !== 0, // Current throttling active
        flags,
        reasons
      };
    }
  } catch (e) {
    // vcgencmd not available (not a Pi or not installed)
  }
  return { throttled: false, flags: 0, reasons: [] };
}

// Get overclock status from boot config or vcgencmd
// Pi 5 base: 2400 MHz, Pi 4 base: 1500 MHz
function getOverclockStatus() {
  let configuredFreq = null;
  
  // Try reading from boot config files (works in container)
  const configPaths = [
    '/host/root/boot/firmware/config.txt',
    '/host/root/boot/config.txt',
    '/boot/firmware/config.txt',
    '/boot/config.txt'
  ];
  
  for (const configPath of configPaths) {
    try {
      const config = fs.readFileSync(configPath, 'utf-8');
      const match = config.match(/^arm_freq=(\d+)/m);
      if (match) {
        configuredFreq = parseInt(match[1], 10);
        break;
      }
    } catch (e) {}
  }
  
  // Fallback to vcgencmd if config file not found
  if (!configuredFreq) {
    try {
      const output = execSync('vcgencmd get_config arm_freq 2>/dev/null', { encoding: 'utf-8', timeout: 1000 });
      const match = output.match(/arm_freq=(\d+)/);
      if (match) configuredFreq = parseInt(match[1], 10);
    } catch (e) {}
  }
  
  if (!configuredFreq) {
    return { configured: null, base: null, overclocked: false };
  }
  
  // Detect Pi model and base frequency
  let baseFreq = 1500; // Default Pi 4
  const modelPaths = [
    '/host/sys/firmware/devicetree/base/model',
    '/sys/firmware/devicetree/base/model',
    '/proc/device-tree/model'
  ];
  for (const modelPath of modelPaths) {
    try {
      const model = fs.readFileSync(modelPath, 'utf-8').replace(/\0/g, '');
      if (model.includes('Pi 5')) { baseFreq = 2400; break; }
      else if (model.includes('Pi 4')) { baseFreq = 1500; break; }
      else if (model.includes('Pi 3')) { baseFreq = 1200; break; }
    } catch (e) {}
  }
  
  return {
    configured: configuredFreq,
    base: baseFreq,
    overclocked: configuredFreq > baseFreq
  };
}

// Cache for CPU calculations (need delta between measurements)
const cpuCache = new Map();
const NUM_CPUS = os.cpus().length;

// Clean up stale CPU cache entries every 60 seconds
// Prevents memory leak when containers are created/destroyed
setInterval(() => {
  const now = Date.now() * 1000; // microseconds
  const staleThreshold = 120000000; // 2 minutes in microseconds
  for (const [id, data] of cpuCache) {
    if (now - data.timeUsec > staleThreshold) {
      cpuCache.delete(id);
    }
  }
}, 60000);

// Known UDP services (VPNs, etc.) - subset of KNOWN_SERVICES for UDP discovery
const KNOWN_UDP_SERVICES = {
  500:   { name: 'IKEv2/IPSec', icon: 'shield', checkType: 'interface', interface: 'ipsec0' },
  1194:  { name: 'OpenVPN', icon: 'shield', checkType: 'interface', interface: 'tun0' },
  1723:  { name: 'PPTP', icon: 'shield', checkType: 'tcp' },
  4500:  { name: 'IPSec NAT-T', icon: 'shield', checkType: 'interface', interface: 'ipsec0' },
  51820: { name: 'WireGuard', icon: 'shield', checkType: 'interface', interface: 'wg0' },
};

export async function discoverServices() {
  const discovered = [];
  const seen = new Set();
  
  try {
    // Get TCP listening ports
    const tcpOutput = execSync(
      'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null',
      { encoding: 'utf-8', timeout: 5000 }
    );
    
    // Get UDP listening ports (for VPNs)
    let udpOutput = '';
    try {
      udpOutput = execSync(
        'ss -ulnp 2>/dev/null || netstat -ulnp 2>/dev/null',
        { encoding: 'utf-8', timeout: 5000 }
      );
    } catch (e) {
      // UDP scan optional
    }
    
    // Process TCP ports
    const tcpLines = tcpOutput.split('\n').filter(l => l.includes('LISTEN'));
    
    for (const line of tcpLines) {
      const addrMatch = line.match(/(?:0\.0\.0\.0|127\.0\.0\.1|\*|::):(\d+)/);
      if (!addrMatch) continue;
      
      const port = parseInt(addrMatch[1], 10);
      if (port > 32767 || seen.has(port)) continue;
      seen.add(port);
      
      const isLocalhost = line.includes('127.0.0.1');
      if (isLocalhost) continue;
      
      const processMatch = line.match(/users:\(\("([^"]+)"/);
      const processName = processMatch ? processMatch[1] : null;
      
      let service = null;
      if (processName && KNOWN_PROCESSES[processName]) {
        service = { ...KNOWN_PROCESSES[processName], port };
      } else if (KNOWN_SERVICES[port]) {
        service = { ...KNOWN_SERVICES[port], port };
      } else if (port < 10000) {
        service = {
          name: processName ? `${processName}` : `Port ${port}`,
          port,
          icon: 'server',
          checkType: 'tcp',
          path: '/'
        };
      }
      
      if (service) {
        discovered.push({
          name: service.name,
          port: service.port,
          path: service.path || '/',
          host: 'localhost',
          icon: service.icon || 'server',
          checkType: service.checkType || 'tcp',
          enabled: true,
          discovered: true,
          process: processName || null
        });
      }
    }
    
    // Process UDP ports (VPNs)
    const udpLines = udpOutput.split('\n').filter(l => l.includes('UNCONN') || l.includes('udp'));
    
    for (const line of udpLines) {
      const addrMatch = line.match(/(?:0\.0\.0\.0|\*|::):(\d+)/);
      if (!addrMatch) continue;
      
      const port = parseInt(addrMatch[1], 10);
      if (seen.has(port)) continue;
      
      // Only add known UDP services (VPNs)
      if (KNOWN_UDP_SERVICES[port]) {
        seen.add(port);
        const service = KNOWN_UDP_SERVICES[port];
        discovered.push({
          name: service.name,
          port: port,
          path: service.interface || '',
          host: 'localhost',
          icon: service.icon,
          checkType: service.checkType,
          enabled: true,
          discovered: true,
          protocol: 'udp'
        });
      }
    }
    
    // Sort by port
    discovered.sort((a, b) => a.port - b.port);
    
  } catch (error) {
    console.error('Service discovery failed:', error.message);
  }
  
  return discovered;
}

// Detect memory type from baseboard model (Raspberry Pi)
function detectMemoryType(baseboardModel) {
  if (!baseboardModel) return null;
  const model = baseboardModel.toLowerCase();
  if (model.includes('raspberry pi 5') || model.includes('pi 5')) return 'LPDDR4X';
  if (model.includes('raspberry pi 4') || model.includes('pi 4')) return 'LPDDR4';
  if (model.includes('raspberry pi 3') || model.includes('pi 3')) return 'LPDDR2';
  if (model.includes('raspberry pi') || model.includes('pi')) return 'LPDDR2';
  return null;
}

export async function getSystemInfo() {
  const [cpu, system, mem, osInfo, baseboard] = await Promise.all([
    si.cpu(),
    si.system(),
    si.mem(),
    si.osInfo(),
    si.baseboard()
  ]);

  // Use baseboard info as fallback for system info (Docker container issue)
  const manufacturer = system.manufacturer || baseboard.manufacturer || '';
  const model = (system.model === 'Docker Container' || !system.model) 
    ? `${baseboard.model || ''} ${baseboard.version || ''}`.trim()
    : system.model;
  
  // Detect memory type from baseboard model + version
  const fullModel = `${baseboard.model || ''} ${baseboard.version || ''}`.trim();
  const memType = mem.type && mem.type !== 'Unknown' ? mem.type : detectMemoryType(fullModel);

  return {
    cpu: {
      manufacturer: cpu.manufacturer,
      brand: cpu.brand,
      speed: cpu.speed,
      speedMax: cpu.speedMax,
      cores: cpu.cores,
      physicalCores: cpu.physicalCores,
      processors: cpu.processors
    },
    system: {
      manufacturer: manufacturer,
      model: model,
      version: system.version || baseboard.version || '',
      serial: system.serial,
      uuid: system.uuid
    },
    memory: {
      total: mem.total,
      type: memType || 'Unknown',
      formFactor: mem.formFactor || 'SODIMM'
    },
    os: (() => {
      const hostOs = getHostOsInfo();
      return {
        platform: osInfo.platform,
        distro: hostOs?.distro || osInfo.distro,
        version: hostOs?.version || osInfo.release,
        release: hostOs?.release || osInfo.release,
        codename: hostOs?.codename || osInfo.codename,
        kernel: osInfo.kernel,
        arch: osInfo.arch,
        hostname: osInfo.hostname,
        fqdn: osInfo.fqdn,
        updatesAvailable: hostOs?.updatesAvailable || 0
      };
    })(),
    baseboard: {
      manufacturer: baseboard.manufacturer,
      model: baseboard.model,
      version: baseboard.version
    }
  };
}

// Get disk info (works both on host and in container)
async function getHostDisks() {
  try {
    // Check if we're in a container with host root mounted
    const hostRootExists = fs.existsSync('/host/root/proc');
    
    if (hostRootExists) {
      // Use nsenter with pid:host to run df in host namespace
      try {
        const output = execSync(
          'nsenter -t 1 -m df -B1 2>/dev/null | grep "^/dev/"',
          { encoding: 'utf-8', timeout: 10000 }
        );
        return parseDF(output);
      } catch (nsenterError) {
        // Fallback: run df on mounted host paths
        return await getHostDisksViaMounts();
      }
    }
    
    // Not in container, use df directly
    const output = execSync(
      'df -B1 2>/dev/null | grep "^/dev/"',
      { encoding: 'utf-8', timeout: 5000 }
    );
    
    return parseDF(output);
  } catch (error) {
    console.error('Failed to get disk info:', error.message);
    return [];
  }
}

// Parse df output
function parseDF(output) {
  const lines = output.trim().split('\n');
  const disks = [];
  const seen = new Set();
  
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    
    const device = parts[0];
    const size = parseInt(parts[1], 10) || 0;
    const used = parseInt(parts[2], 10) || 0;
    const available = parseInt(parts[3], 10) || 0;
    const percentStr = parts[4].replace('%', '');
    const percent = parseFloat(percentStr) || 0;
    const mount = parts[5];
    
    // Skip small partitions, loop devices, boot partitions, and duplicates
    if (size > 100 * 1024 * 1024 && !device.includes('loop') && !mount.startsWith('/boot') && !seen.has(device)) {
      seen.add(device);
      disks.push({
        fs: device,
        mount,
        size,
        used,
        available,
        percent: Math.round(percent * 10) / 10
      });
    }
  }
  
  return disks;
}

// Get disk info via mounted host paths
async function getHostDisksViaMounts() {
  const disks = [];
  const mountPaths = [
    { path: '/host/root', mount: '/' },
    { path: '/host/root/media/ssd', mount: '/media/ssd' }
  ];
  
  for (const { path, mount } of mountPaths) {
    try {
      if (fs.existsSync(path)) {
        const output = execSync(
          `df -B1 "${path}" 2>/dev/null | tail -1`,
          { encoding: 'utf-8', timeout: 5000 }
        );
        const parts = output.trim().split(/\s+/);
        if (parts.length >= 6 && parts[0].startsWith('/dev/')) {
          disks.push({
            fs: parts[0],
            mount: mount,
            size: parseInt(parts[1], 10) || 0,
            used: parseInt(parts[2], 10) || 0,
            available: parseInt(parts[3], 10) || 0,
            percent: Math.round(parseFloat(parts[4].replace('%', '')) * 10) / 10
          });
        }
      }
    } catch (e) {
      // Skip this mount
    }
  }
  
  return disks;
}

// Get top processes using ps aux (more accurate than systeminformation)
async function getTopProcesses() {
  try {
    // With pid:host in docker-compose, ps sees host processes directly
    // Using args for full command line
    const output = execSync(
      'ps -eo pid,%cpu,%mem,stat,etime,comm,args --sort=-%cpu | head -15',
      { encoding: 'utf-8', timeout: 5000 }
    );
    
    const lines = output.trim().split('\n').slice(1); // Skip header
    const processes = [];
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      
      const pid = parseInt(parts[0], 10);
      const cpu = parseFloat(parts[1]) || 0;
      const mem = parseFloat(parts[2]) || 0;
      const stat = parts[3] || '';
      const etime = parts[4] || '00:00';
      const name = parts[5] || 'unknown';
      // Full command is everything from index 6 onwards
      const cmd = parts.slice(6).join(' ') || name;
      
      // Skip kernel threads (pid 1 or 2) and idle processes
      if (pid > 2 && cpu >= 0) {
        processes.push({
          pid,
          name: name.substring(0, 20),
          cpu: Math.round(cpu * 10) / 10,
          mem: Math.round(mem * 10) / 10,
          state: stat,
          time: etime,
          cmd: cmd.substring(0, 80) // Truncate long commands
        });
      }
    }
    
    return processes.slice(0, 10);
  } catch (error) {
    console.error('Failed to get processes:', error.message);
    return [];
  }
}

// Read CPU usage from cgroup v2 cpu.stat
function readCgroupCpuUsage(containerId) {
  const cgroupBase = fs.existsSync('/host/sys/fs/cgroup') 
    ? '/host/sys/fs/cgroup' 
    : '/sys/fs/cgroup';
  
  const cgroupPath = `${cgroupBase}/system.slice/docker-${containerId}.scope/cpu.stat`;
  
  try {
    const content = fs.readFileSync(cgroupPath, 'utf-8');
    const usageMatch = content.match(/usage_usec\s+(\d+)/);
    return usageMatch ? parseInt(usageMatch[1], 10) : null;
  } catch (e) {
    return null;
  }
}

// Calculate CPU percent from delta measurements
// Returns percentage normalized to 100% (total CPU capacity)
// 100% = ALL cores maxed out
function calculateCpuPercent(containerId, currentUsageUsec) {
  if (currentUsageUsec === null) return 0;
  
  const now = Date.now() * 1000; // Convert to microseconds
  const cached = cpuCache.get(containerId);
  
  // Store current measurement
  cpuCache.set(containerId, { usageUsec: currentUsageUsec, timeUsec: now });
  
  if (!cached) return 0; // First measurement, no delta yet
  
  const deltaUsage = currentUsageUsec - cached.usageUsec;
  const deltaTime = now - cached.timeUsec;
  
  if (deltaTime <= 0 || deltaUsage < 0) return 0;
  
  // CPU percent normalized: divide by NUM_CPUS so 100% = all cores maxed
  const cpuPercent = (deltaUsage / deltaTime) * 100 / NUM_CPUS;
  
  return Math.round(cpuPercent * 10) / 10;
}

// Get Docker container stats via Docker socket API + /proc for memory + cgroups for CPU
// Works WITHOUT cgroup memory controller and without docker CLI
async function getDockerContainerStats() {
  try {
    // Use Docker API via socket to get container info
    const containers = await dockerApiGet('/containers/json');
    if (!containers || containers.length === 0) return new Map();
    
    // Get total system memory for percentage calculation
    const procPath = fs.existsSync('/host/proc/meminfo') ? '/host/proc/meminfo' : '/proc/meminfo';
    const memInfo = fs.readFileSync(procPath, 'utf-8');
    const memTotalMatch = memInfo.match(/MemTotal:\s+(\d+)/);
    const memTotalKB = memTotalMatch ? parseInt(memTotalMatch[1], 10) : 1;
    
    const statsMap = new Map();
    
    for (const container of containers) {
      const shortId = container.Id.substring(0, 12);
      const fullId = container.Id;
      
      // Get detailed container info including PID
      try {
        const info = await dockerApiGet(`/containers/${fullId}/json`);
        const pid = info.State?.Pid;
        
        // Memory from /proc/[PID]/status
        let memUsageKB = 0;
        if (pid && pid > 0) {
          const procStatusPath = fs.existsSync('/host/proc') 
            ? `/host/proc/${pid}/status`
            : `/proc/${pid}/status`;
          
          try {
            const status = fs.readFileSync(procStatusPath, 'utf-8');
            const vmRssMatch = status.match(/VmRSS:\s+(\d+)/);
            memUsageKB = vmRssMatch ? parseInt(vmRssMatch[1], 10) : 0;
          } catch (e) {
            // Process might have exited or no access
          }
        }
        
        // CPU from cgroups
        const cpuUsageUsec = readCgroupCpuUsage(fullId);
        const cpuPercent = calculateCpuPercent(fullId, cpuUsageUsec);
        
        const memPercent = (memUsageKB / memTotalKB) * 100;
        
        statsMap.set(shortId, {
          cpuPercent,
          memPercent: Math.round(memPercent * 10) / 10,
          memUsage: memUsageKB * 1024,
          memLimit: memTotalKB * 1024,
          netIO: { rx: 0, tx: 0 },
          blockIO: { r: 0, w: 0 }
        });
      } catch (e) {
        // Container might have stopped
      }
    }

    return statsMap;
  } catch (error) {
    console.error('Docker stats failed:', error.message);
    return new Map();
  }
}

// Helper: Docker API GET request via socket
function dockerApiGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      socketPath: '/var/run/docker.sock',
      path: path,
      method: 'GET',
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Docker API timeout'));
    });
    req.end();
  });
}


// Read host OS info from /etc/os-release + /etc/rpi-issue
function getHostOsInfo() {
  try {
    const hostRoot = fs.existsSync('/host/root/etc') ? '/host/root' : '';
    const osReleasePath = `${hostRoot}/etc/os-release`;
    const rpiIssuePath = `${hostRoot}/etc/rpi-issue`;
    
    const content = fs.readFileSync(osReleasePath, 'utf-8');
    const info = {};
    
    content.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length) {
        info[key] = valueParts.join('=').replace(/^"|"$/g, '');
      }
    });
    
    let distro = info.PRETTY_NAME || info.NAME || 'Linux';
    
    // Check for Raspberry Pi OS (rpi-issue exists)
    let version = info.VERSION_ID || '';
    if (fs.existsSync(rpiIssuePath)) {
      try {
        const rpiIssue = fs.readFileSync(rpiIssuePath, 'utf-8');
        if (rpiIssue.includes('Raspberry Pi')) {
          // Extract date from rpi-issue as version
          const dateMatch = rpiIssue.match(/(\d{4}-\d{2}-\d{2})/);
          version = dateMatch ? dateMatch[1] : version;
          const codename = info.VERSION_CODENAME ? ` (${info.VERSION_CODENAME})` : '';
          distro = `Raspberry Pi OS${codename}`;
        }
      } catch (e) {
        // Ignore
      }
    }
    
    // Check for available updates (apt)
    let updatesAvailable = 0;
    try {
      const aptOutput = execSync(
        'apt list --upgradable 2>/dev/null | grep -v "Listing" | wc -l',
        { encoding: 'utf-8', timeout: 10000 }
      ).trim();
      updatesAvailable = parseInt(aptOutput, 10) || 0;
    } catch (e) {
      // apt not available or error
    }
    
    return {
      distro,
      version,
      release: info.VERSION_ID || '',
      codename: info.VERSION_CODENAME || '',
      updatesAvailable
    };
  } catch (e) {
    return null;
  }
}

// Cache for static/slow-changing data
const staticCache = {
  osInfo: null,
  hostOsInfo: null,
  networkInterfaces: null,
  lastDiskCheck: 0,
  disks: [],
  lastStaticRefresh: 0
};

// Cache for network stats delta calculation
const networkCache = {
  lastStats: new Map(),
  lastTime: 0
};

const STATIC_CACHE_TTL = 60000;  // 1 minute for static data
const DISK_CACHE_TTL = 30000;    // 30 seconds for disk data

// Read network stats from host /proc/net/dev
function getHostNetworkStats() {
  try {
    const procPath = fs.existsSync('/host/proc/net/dev') ? '/host/proc/net/dev' : '/proc/net/dev';
    const content = fs.readFileSync(procPath, 'utf-8');
    const lines = content.trim().split('\n').slice(2); // Skip headers
    
    const now = Date.now();
    const deltaMs = networkCache.lastTime > 0 ? now - networkCache.lastTime : 1000;
    const stats = [];
    
    for (const line of lines) {
      const parts = line.trim().split(/[:\s]+/);
      if (parts.length < 11) continue;
      
      const iface = parts[0];
      // Skip loopback, veth, and bridge interfaces
      if (iface === 'lo' || iface.startsWith('veth') || iface.startsWith('br-') || iface === 'docker0') continue;
      
      const rxBytes = parseInt(parts[1], 10) || 0;
      const txBytes = parseInt(parts[9], 10) || 0;
      
      // Calculate per-second rates from delta
      const lastStat = networkCache.lastStats.get(iface);
      let rxSec = 0, txSec = 0;
      if (lastStat) {
        rxSec = Math.max(0, Math.round((rxBytes - lastStat.rxBytes) / (deltaMs / 1000)));
        txSec = Math.max(0, Math.round((txBytes - lastStat.txBytes) / (deltaMs / 1000)));
      }
      
      networkCache.lastStats.set(iface, { rxBytes, txBytes });
      
      stats.push({
        iface,
        rxBytes,
        txBytes,
        rxSec,
        txSec
      });
    }
    
    networkCache.lastTime = now;
    return stats;
  } catch (error) {
    console.error('Failed to read host network stats:', error.message);
    return [];
  }
}

// Get combined host network info (interfaces + stats in one call)
function getHostNetworkInfo() {
  const stats = getHostNetworkStats();
  const interfaces = [];
  
  for (const stat of stats) {
    // Get IP using ip command (Alpine-compatible)
    let ip4 = '';
    try {
      const output = execSync(
        `ip -4 addr show ${stat.iface} 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1`,
        { encoding: 'utf-8', timeout: 1000 }
      ).trim();
      ip4 = output.split('\n')[0] || '';
    } catch (e) {
      // Interface might not have an IP
    }
    
    interfaces.push({
      name: stat.iface,
      ip4: ip4 || 'N/A',
      mac: '',
      type: stat.iface.startsWith('wg') ? 'vpn' : stat.iface.startsWith('wl') ? 'wireless' : 'wired',
      speed: 0
    });
  }
  
  return { interfaces, stats };
}

export async function getSystemStats() {
  const now = Date.now();
  
  // Refresh static data only every minute
  if (!staticCache.osInfo || now - staticCache.lastStaticRefresh > STATIC_CACHE_TTL) {
    const [osInfo, networkInterfaces] = await Promise.all([
      si.osInfo(),
      si.networkInterfaces().catch(() => [])
    ]);
    staticCache.osInfo = osInfo;
    staticCache.hostOsInfo = getHostOsInfo();
    staticCache.networkInterfaces = networkInterfaces;
    staticCache.lastStaticRefresh = now;
  }
  
  // Refresh disk data only every 30 seconds
  if (now - staticCache.lastDiskCheck > DISK_CACHE_TTL) {
    staticCache.disks = await getHostDisks();
    staticCache.lastDiskCheck = now;
  }
  
  // Fast-changing data - fetch every time
  const [cpu, mem, temp, time, networkStats, cpuSpeed] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.cpuTemperature(),
    si.time(),
    si.networkStats().catch(() => []),
    si.cpuCurrentSpeed().catch(() => ({ avg: 0, cores: [] }))
  ]);
  
  const osInfo = staticCache.osInfo;
  const networkInterfaces = staticCache.networkInterfaces;

  // Get Docker containers with stats
  let containers = [];
  try {
    // Get container list from systeminformation
    const dockerContainers = await si.dockerContainers();
    
    if (dockerContainers.length > 0) {
      // Get real stats using docker stats command
      const statsMap = await getDockerContainerStats();
      
      containers = dockerContainers.map(container => {
        // Match by short ID (first 12 chars)
        const shortId = container.id.substring(0, 12);
        const stats = statsMap.get(shortId) || {};
        
        return {
          id: container.id,
          name: container.name,
          image: container.image,
          state: container.state,
          status: container.status,
          started: container.started,
          cpuPercent: stats.cpuPercent || 0,
          memPercent: stats.memPercent || 0,
          memUsage: stats.memUsage || 0,
          memLimit: stats.memLimit || 0,
          netIO: stats.netIO || { rx: 0, tx: 0 },
          blockIO: stats.blockIO || { r: 0, w: 0 }
        };
      });
    }
  } catch (error) {
    console.error('Docker containers error:', error.message);
    containers = [];
  }

  const overclock = getOverclockStatus();
  
  return {
    cpu: {
      usage: Math.round(cpu.currentLoad * 10) / 10,
      cores: cpu.cpus.map(c => Math.round(c.load * 10) / 10),
      speed: cpuSpeed.avg || 0,
      speedMax: overclock.configured ? overclock.configured / 1000 : (staticCache.cpuInfo?.speedMax || cpuSpeed.max || 0),
      ...overclock
    },
    memory: {
      total: mem.total,
      used: mem.active || (mem.total - mem.available - (mem.buffcache || 0)),  // Active memory (truly used)
      buffcache: mem.buffcache || (mem.buffers || 0) + (mem.cached || 0),  // Buffers + cache
      free: mem.available,              // Actually available memory
      percent: Math.round(((mem.total - mem.available) / mem.total) * 1000) / 10,
      usedPercent: Math.round(((mem.active || (mem.total - mem.available - (mem.buffcache || 0))) / mem.total) * 1000) / 10,
      buffcachePercent: Math.round(((mem.buffcache || 0) / mem.total) * 1000) / 10
    },
    temperature: {
      main: temp.main || 0,
      max: temp.max || 0,
      ...getThrottleStatus()
    },
    load: {
      avgLoad: os.loadavg()[0],  // Use OS loadavg instead of expensive si.fullLoad()
      uptime: time.uptime,
      loadAvg: os.loadavg().map(l => Math.round(l * 100) / 100)
    },
    os: {
      platform: osInfo.platform,
      distro: staticCache.hostOsInfo?.distro || osInfo.distro,
      version: staticCache.hostOsInfo?.version || osInfo.release,
      release: staticCache.hostOsInfo?.release || osInfo.release,
      hostname: osInfo.hostname,
      arch: osInfo.arch,
      updatesAvailable: staticCache.hostOsInfo?.updatesAvailable || 0
    },
    disks: staticCache.disks,
    containers,
    network: getHostNetworkInfo(),
    processes: await getTopProcesses()
  };
}
