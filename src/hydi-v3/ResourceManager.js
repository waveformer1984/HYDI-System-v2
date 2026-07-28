'use strict';

const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

class ResourceManager {
  constructor(config = {}) {
    this.logger = config.logger || console;
    this.modelStates = new Map();
    this.gpu = null;
    this.gpuChecked = false;
  }

  snapshot() {
    return {
      cpus: os.cpus().length,
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      loadAvg: os.loadavg ? os.loadavg() : [0, 0, 0],
      heapUsed: process.memoryUsage().heapUsed,
      gpu: this.gpu,
      at: Date.now(),
    };
  }

  async detectGPU() {
    if (this.gpuChecked) return this.gpu;
    try {
      let out;
      if (process.platform === 'win32') {
        const { stdout } = await execAsync('wmic path win32_VideoController get Name /value 2>nul', { timeout: 5000 });
        out = stdout;
      } else {
        const { stdout } = await execAsync('lspci | grep -i vga || true', { timeout: 5000 });
        out = stdout;
      }
      this.gpu = { present: true, info: out.trim().split('\n').filter(Boolean).slice(0, 3) };
    } catch (e) {
      this.gpu = { present: false, error: e instanceof Error ? e.message : String(e) };
    }
    this.gpuChecked = true;
    return this.gpu;
  }

  canRun(model) {
    const snap = this.snapshot();
    const modelSize = model.size || 0;
    // Conservative: need 2x model size free for quantization overhead.
    return snap.freeMem > modelSize * 2;
  }

  markModelWarm(modelId, warm = true) {
    this.modelStates.set(modelId, { warm, since: Date.now() });
  }

  isModelWarm(modelId) {
    return this.modelStates.get(modelId)?.warm === true;
  }

  recommendPlacement(task, candidates) {
    const snap = this.snapshot();
    const underMemoryPressure = snap.freeMem / snap.totalMem < 0.15;
    const underLoad = snap.loadAvg[0] > snap.cpus;

    let list = candidates.filter((m) => this.canRun(m));
    if (list.length === 0) list = candidates; // fall back to all, will be slow

    if (underMemoryPressure || underLoad) {
      // prefer smallest loaded model
      list = list.filter((m) => this.isModelWarm(m.id));
      if (list.length === 0) list = candidates;
      list.sort((a, b) => (a.size || Infinity) - (b.size || Infinity));
    }
    return list[0] || null;
  }
  detectCPUSaturation() {
    const snap = this.snapshot();
    return (snap.loadAvg[0] / Math.max(1, snap.cpus)) > 0.8;
  }

  detectRAMPressure() {
    const snap = this.snapshot();
    return snap.freeMem / Math.max(1, snap.totalMem) < 0.15;
  }

  async detectGPUUtilization() {
    await this.detectGPU();
    if (!this.gpu || !this.gpu.present) return { present: false, utilization: null };
    return { present: true, utilization: null, note: 'GPU present; utilization sampling not implemented' };
  }

  async detectThermalThrottling() {
    return { throttling: false, note: 'Thermal state not available on this platform' };
  }

  detectModelWarmState(modelId) {
    return this.isModelWarm(modelId);
  }

  async hardwareReport() {
    const [gpu, cpuSaturation, ramPressure, thermal] = await Promise.all([
      this.detectGPUUtilization().catch(() => ({ present: false })),
      Promise.resolve(this.detectCPUSaturation()),
      Promise.resolve(this.detectRAMPressure()),
      this.detectThermalThrottling().catch(() => ({ throttling: false })),
    ]);
    return {
      cpuSaturation,
      ramPressure,
      gpu,
      thermalThrottling: thermal.throttling,
      modelWarmStates: Object.fromEntries(this.modelStates),
    };
  }

  recommendForTask(task, candidates) {
    if (!candidates || !candidates.length) return null;
    const snap = this.snapshot();
    const underMemoryPressure = snap.freeMem / Math.max(1, snap.totalMem) < 0.15;
    const underLoad = (snap.loadAvg[0] / Math.max(1, snap.cpus)) > 0.8;

    let list = candidates.filter((m) => this.canRun(m));
    if (list.length === 0) list = candidates.slice();

    if (task === 'embedding') {
      const embed = list.find((m) => (m.capabilities || []).includes('embed'));
      if (embed) return embed;
    }

    if (task === 'reasoning' || task === 'planning' || task === 'rag') {
      const reasoning = list
        .filter((m) => (m.capabilities || []).includes('reasoning') || (m.capabilities || []).includes('chat'))
        .sort((a, b) => (b.contextSize || 0) - (a.contextSize || 0))[0];
      if (reasoning) return reasoning;
    }

    if (task === 'simple' || task === 'intentExtraction' || task === 'conversation') {
      const light = list
        .filter((m) => !underMemoryPressure || (m.size || Infinity) < 2_000_000_000)
        .sort((a, b) => (a.size || Infinity) - (b.size || Infinity))[0];
      if (light) return light;
    }

    if (underMemoryPressure || underLoad) {
      list = list.filter((m) => this.isModelWarm(m.id));
      if (list.length === 0) list = candidates.slice();
      list.sort((a, b) => (a.size || Infinity) - (b.size || Infinity));
    }

    return list[0] || null;
  }
}

module.exports = ResourceManager;
