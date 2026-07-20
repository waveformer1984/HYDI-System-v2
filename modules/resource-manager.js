/**
 * HYDI Resource Manager
 *
 * Tracks and allocates system resources across agents and services:
 *   - CPU
 *   - RAM
 *   - GPU (if available)
 *   - Agent slots
 *
 * Decisions:
 *   if (gpu > 90) downgradeAgent();
 *   if (ram > 90) throttleServices();
 */

const EventEmitter = require('events');
const os = require('os');
const { exec } = require('child_process');

class ResourceManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      cpuThreshold: 90,      // %
      ramThreshold: 90,      // %
      gpuThreshold: 90,      // %
      agentThreshold: 50,    // max agents before throttling
      pollInterval: 5000,    // 5s
      throttleStep: 0.2,     // reduce load by 20% when throttling
      gpuSampleTimeout: 2000, // ms, budget for the nvidia-smi child process
      ...config
    };

    this.registry = null;
    this.eventSystem = null;

    // GPU sampling is async (spawns nvidia-smi) but sampleResources() runs
    // synchronously on a timer, so we cache the last known value and refresh
    // it in the background rather than blocking the poll loop.
    this._gpuAvailable = null; // null = undetermined, true/false once probed
    this._gpuSampleInFlight = false;
    this._lastGpuPercent = 0;

    this.resources = {
      cpu: { current: 0, peak: 0, history: [] },
      ram: { current: 0, peak: 0, history: [] },
      gpu: { current: 0, peak: 0, history: [] },
      agents: { current: 0, peak: 0, history: [], limit: this.config.agentThreshold }
    };

    this.allocations = new Map(); // serviceId -> { cpu, ram, gpu }
    this.throttled = new Set();   // serviceIds currently throttled
    this.running = false;
    this.timer = null;

    console.log('[RESOURCE MANAGER] Initialized');
  }

  setRegistry(registry) {
    this.registry = registry;
  }

  setEventSystem(eventSystem) {
    this.eventSystem = eventSystem;
  }

  /**
   * Start resource monitoring
   */
  start() {
    if (this.running) return;
    this.running = true;

    this.timer = setInterval(() => {
      this.sampleResources();
    }, this.config.pollInterval);

    console.log('[RESOURCE MANAGER] Monitoring started');
  }

  /**
   * Stop resource monitoring
   */
  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[RESOURCE MANAGER] Stopped');
  }

  /**
   * Sample current system resources
   */
  sampleResources() {
    // CPU: simple loadavg average over 1 min normalized to core count
    const loadAvg = os.loadavg ? os.loadavg()[0] : 0;
    const cpus = os.cpus ? os.cpus().length : 1;
    const cpuPercent = Math.min(100, Math.round((loadAvg / cpus) * 100));

    // RAM
    const totalMem = os.totalmem ? os.totalmem() : 0;
    const freeMem = os.freemem ? os.freemem() : 0;
    const usedMem = totalMem - freeMem;
    const ramPercent = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0;

    // Agent count from registry
    const agentCount = this.registry ? this.registry.services.size : 0;

    // GPU: placeholder (would require nvidia-smi or similar)
    const gpuPercent = this.sampleGPU();

    this.resources.cpu.current = cpuPercent;
    this.resources.ram.current = ramPercent;
    this.resources.gpu.current = gpuPercent;
    this.resources.agents.current = agentCount;

    // Track peaks
    if (cpuPercent > this.resources.cpu.peak) this.resources.cpu.peak = cpuPercent;
    if (ramPercent > this.resources.ram.peak) this.resources.ram.peak = ramPercent;
    if (gpuPercent > this.resources.gpu.peak) this.resources.gpu.peak = gpuPercent;
    if (agentCount > this.resources.agents.peak) this.resources.agents.peak = agentCount;

    // Push history (keep last 100)
    this.pushHistory('cpu', cpuPercent);
    this.pushHistory('ram', ramPercent);
    this.pushHistory('gpu', gpuPercent);
    this.pushHistory('agents', agentCount);

    // Evaluate thresholds and take action
    this.evaluateThresholds(cpuPercent, ramPercent, gpuPercent, agentCount);

    this.emit('resources_sampled', { cpu: cpuPercent, ram: ramPercent, gpu: gpuPercent, agents: agentCount });
  }

  /**
   * Push a value into rolling history
   */
  pushHistory(resource, value) {
    const arr = this.resources[resource].history;
    arr.push({ timestamp: Date.now(), value });
    if (arr.length > 100) arr.shift();
  }

  /**
   * Sample GPU utilization. Returns the last known value synchronously (the
   * poll loop can't block on a child process) and kicks off a background
   * refresh via nvidia-smi. Once nvidia-smi is confirmed unavailable, no
   * further attempts are made and this always returns 0.
   */
  sampleGPU() {
    if (this._gpuAvailable === false) return 0;

    if (!this._gpuSampleInFlight) {
      this._gpuSampleInFlight = true;
      this._refreshGPU();
    }

    return this._lastGpuPercent;
  }

  /**
   * Spawn nvidia-smi to sample utilization across all visible GPUs and
   * average them. Degrades to gpuAvailable=false on any error (missing
   * binary, no GPU, timeout) so we stop paying the exec cost.
   */
  _refreshGPU() {
    exec(
      'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits',
      { timeout: this.config.gpuSampleTimeout },
      (err, stdout) => {
        this._gpuSampleInFlight = false;

        if (err) {
          this._gpuAvailable = false;
          this._lastGpuPercent = 0;
          return;
        }

        this._gpuAvailable = true;
        const values = String(stdout)
          .split('\n')
          .map((line) => parseInt(line.trim(), 10))
          .filter((n) => !Number.isNaN(n));

        this._lastGpuPercent = values.length > 0
          ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
          : 0;
      }
    );
  }

  /**
   * Evaluate resource thresholds and trigger throttling or alerts
   */
  evaluateThresholds(cpu, ram, gpu, agents) {
    const alerts = [];

    if (cpu > this.config.cpuThreshold) {
      alerts.push({ resource: 'cpu', level: 'critical', value: cpu });
      this.throttleServices('cpu');
    }

    if (ram > this.config.ramThreshold) {
      alerts.push({ resource: 'ram', level: 'critical', value: ram });
      this.throttleServices('ram');
    }

    if (gpu > this.config.gpuThreshold) {
      alerts.push({ resource: 'gpu', level: 'critical', value: gpu });
      this.throttleGPUConsumers();
    }

    if (agents > this.config.agentThreshold) {
      alerts.push({ resource: 'agents', level: 'warning', value: agents });
      this.throttleAgentSpawns();
    }

    if (alerts.length > 0) {
      this.emit('resource_alert', { alerts, timestamp: Date.now() });
      this.publishEvent('resource_alert', { alerts });

      for (const alert of alerts) {
        console.warn(`[RESOURCE MANAGER] ${alert.resource.toUpperCase()} alert: ${alert.value}% (${alert.level})`);
      }
    }
  }

  /**
   * Throttle non-critical services when CPU/RAM is high
   */
  throttleServices(reason) {
    if (!this.registry) return;

    for (const [id, record] of this.registry.services) {
      // Skip critical services
      if (record.type === 'agent' && (id === 'heidi_executive' || id === 'ursula')) continue;

      if (!this.throttled.has(id)) {
        this.throttled.add(id);
        this.emit('service_throttled', { serviceId: id, reason });
        console.log(`[RESOURCE MANAGER] Throttled service: ${id} (${reason})`);
      }
    }
  }

  /**
   * Throttle GPU-intensive consumers
   */
  throttleGPUConsumers() {
    if (!this.registry) return;

    for (const [id, record] of this.registry.services) {
      const caps = record.capabilities || [];
      const isGPUConsumer = caps.includes('gpu_compute') || caps.includes('model_inference');
      if (isGPUConsumer && !this.throttled.has(id)) {
        this.throttled.add(id);
        this.emit('service_throttled', { serviceId: id, reason: 'gpu' });
        console.log(`[RESOURCE MANAGER] Throttled GPU consumer: ${id}`);
      }
    }
  }

  /**
   * Prevent new agent spawns when agent count is high
   */
  throttleAgentSpawns() {
    this.emit('agent_spawns_throttled', {
      current: this.resources.agents.current,
      limit: this.config.agentThreshold
    });
  }

  /**
   * Release throttling on a service
   */
  unthrottle(serviceId) {
    if (this.throttled.has(serviceId)) {
      this.throttled.delete(serviceId);
      this.emit('service_unthrottled', { serviceId });
      console.log(`[RESOURCE MANAGER] Unthrottled service: ${serviceId}`);
    }
  }

  /**
   * Allocate resources to a service
   */
  allocate(serviceId, request = {}) {
    const allocation = {
      cpu: request.cpu || 0,
      ram: request.ram || 0,
      gpu: request.gpu || 0,
      allocatedAt: Date.now()
    };

    this.allocations.set(serviceId, allocation);
    this.emit('resource_allocated', { serviceId, allocation });
    return allocation;
  }

  /**
   * Release allocated resources
   */
  release(serviceId) {
    const alloc = this.allocations.get(serviceId);
    if (alloc) {
      this.allocations.delete(serviceId);
      this.emit('resource_released', { serviceId, allocation: alloc });
    }
  }

  /**
   * Get current resource status
   */
  getStatus() {
    return {
      resources: {
        cpu: { ...this.resources.cpu, threshold: this.config.cpuThreshold },
        ram: { ...this.resources.ram, threshold: this.config.ramThreshold },
        gpu: { ...this.resources.gpu, threshold: this.config.gpuThreshold },
        agents: { ...this.resources.agents, threshold: this.config.agentThreshold }
      },
      allocations: Object.fromEntries(this.allocations),
      throttled: Array.from(this.throttled),
      timestamp: Date.now()
    };
  }

  /**
   * Publish event to event system if available
   */
  publishEvent(topic, payload) {
    if (this.eventSystem && this.eventSystem.publishSystemEvent) {
      this.eventSystem.publishSystemEvent(topic, payload, { priority: 'medium' });
    }
  }
}

module.exports = ResourceManager;
