import { History } from '../history.js';
import { readDisks } from './disks.js';
import { createDockerSampler } from './docker.js';
import {
  createCpuSampler,
  createNetworkSampler,
  createOsInfoReader,
  createTemperatureReader,
  createThrottleReader,
  describeInterfaces,
  parseMeminfo,
  readCpuFrequency,
  readLoad,
  readOverclock,
} from './host.js';
import { createProcessSampler } from './processes.js';
import { readText } from '../util.js';
import { VERSION } from '../config.js';

const FAST_MS = 1000;
const IDLE_MS = 5000;
const ACTIVE_WINDOW_MS = 15000;
const DISK_EVERY_MS = 30000;
const OVERCLOCK_EVERY_MS = 60000;

/**
 * One sampling loop for everyone. Requests read the latest snapshot instead of each
 * re-measuring the host, so rates stay correct with several clients and the load does not
 * grow with the number of open tabs. The loop slows down when nobody is watching.
 */
export class Collector {
  #config;
  #timer = null;
  #running = false;
  #lastRequestAt = 0;
  #snapshot = null;
  #disks = { at: 0, value: [] };
  #overclock = { at: 0, value: { configured: null, base: null, overclocked: false } };
  #firstSample = null;

  constructor(config) {
    this.#config = config;
    const { proc, sys, root } = config.host;
    this.history = new History();
    this.sampleCpu = createCpuSampler(proc);
    this.sampleNetwork = createNetworkSampler(proc);
    this.sampleProcesses = createProcessSampler(proc);
    this.sampleContainers = createDockerSampler({ socketPath: config.dockerSocket, procRoot: proc, sysRoot: sys });
    this.readTemperature = createTemperatureReader(sys);
    this.readThrottle = createThrottleReader(sys);
    this.readOsInfo = createOsInfoReader(root);
  }

  start() {
    if (this.#timer || this.#running) return;
    // Prime the delta-based samplers so the first published snapshot has real rates.
    this.sampleCpu();
    this.sampleNetwork();
    this.sampleProcesses();
    this.#firstSample = new Promise(resolve => {
      this.#timer = setTimeout(() => this.#tick().then(resolve), 500);
    });
  }

  stop() {
    clearTimeout(this.#timer);
    this.#timer = null;
    this.#running = false;
  }

  /** Latest snapshot; marks the dashboard as being watched so sampling stays fast. */
  async stats() {
    this.#lastRequestAt = Date.now();
    if (!this.#snapshot) {
      if (!this.#firstSample) this.start();
      await this.#firstSample;
    }
    return this.#snapshot;
  }

  async #tick() {
    this.#running = true;
    try {
      this.#snapshot = await this.#collect();
    } catch (error) {
      console.error('Sampling failed:', error.message);
    }
    if (!this.#running) return;
    const active = Date.now() - this.#lastRequestAt < ACTIVE_WINDOW_MS;
    this.#timer = setTimeout(() => this.#tick(), active ? FAST_MS : IDLE_MS);
    this.#timer.unref?.();
  }

  async #collect() {
    const { proc, sys, root } = this.#config.host;
    const now = Date.now();

    if (now - this.#disks.at > DISK_EVERY_MS) {
      this.#disks = { at: now, value: await readDisks({ procRoot: proc, hostRoot: root }) };
    }
    if (now - this.#overclock.at > OVERCLOCK_EVERY_MS) {
      this.#overclock = { at: now, value: readOverclock(root, sys) };
    }

    const [temperature, throttle, os, containers] = await Promise.all([
      this.readTemperature(),
      this.readThrottle(),
      this.readOsInfo(),
      this.sampleContainers(),
    ]);
    const cpu = this.sampleCpu();
    const frequency = readCpuFrequency(sys);
    const overclock = this.#overclock.value;
    const memory = parseMeminfo(readText(`${proc}/meminfo`) || '');
    const load = readLoad(proc);
    const network = this.sampleNetwork();

    // The codename is only part of /api/sysinfo, as before.
    const { codename, ...osPublic } = os;

    this.history.record(
      {
        cpu: cpu.usage,
        memory: memory.percent,
        temperature: temperature.main,
        load: load.loadAvg[0],
        rx: network.filter(n => !/^(wg|tun|tap)/.test(n.iface)).reduce((sum, n) => sum + n.rxSec, 0),
        tx: network.filter(n => !/^(wg|tun|tap)/.test(n.iface)).reduce((sum, n) => sum + n.txSec, 0),
      },
      now,
    );

    return {
      timestamp: now,
      version: VERSION,
      cpu: {
        usage: cpu.usage,
        cores: cpu.cores,
        speed: frequency.speed,
        speedMax: overclock.configured ? overclock.configured / 1000 : frequency.speedMax,
        ...overclock,
      },
      memory,
      temperature: { ...temperature, ...throttle },
      load,
      os: osPublic,
      disks: this.#disks.value,
      containers,
      network: { interfaces: describeInterfaces(network), stats: network },
      processes: this.sampleProcesses(),
    };
  }
}
