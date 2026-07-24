'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const { platform } = require('os');

const execFileAsync = promisify(execFile);

/**
 * HardwareDiscovery detects local GPU hardware and CUDA capabilities.
 *
 * It is intentionally platform-agnostic: it tries NVIDIA SMI first, then falls
 * back to OS-level video controller enumeration so non-NVIDIA or headless
 * environments still produce a deterministic inventory.
 */
class HardwareDiscovery {
  constructor(config = {}) {
    this.config = {
      nvidiaSmiPath: config.nvidiaSmiPath || 'nvidia-smi',
      timeoutMs: config.timeoutMs || 10000,
      ...config,
    };
    this.lastInventory = null;
    this.lastRunAt = null;
  }

  /**
   * Run a full hardware discovery pass.
   * @returns {Promise<{timestamp: string, cudaAvailable: boolean, driverVersion: string|null, cudaVersion: string|null, gpus: object[]}>}
   */
  async detect() {
    const inventory = {
      timestamp: new Date().toISOString(),
      cudaAvailable: false,
      driverVersion: null,
      cudaVersion: null,
      gpus: [],
    };

    // Prefer detailed NVIDIA SMI data when available.
    const nvidia = await this.detectNvidia();
    if (nvidia) {
      inventory.cudaAvailable = nvidia.gpus.length > 0;
      inventory.driverVersion = nvidia.driverVersion;
      inventory.cudaVersion = nvidia.cudaVersion;
      inventory.gpus = nvidia.gpus;
    }

    // Fallback / complement with OS-level GPU enumeration.
    const osGpus = await this.detectOsGpus();
    for (const gpu of osGpus) {
      const existing = inventory.gpus.find(
        (g) => g.name && g.name.toLowerCase() === gpu.name.toLowerCase()
      );
      if (!existing) {
        inventory.gpus.push(gpu);
      }
    }

    this.lastInventory = inventory;
    this.lastRunAt = Date.now();
    return inventory;
  }

  /**
   * Get the last cached inventory without re-running detection.
   */
  getLastInventory() {
    return this.lastInventory;
  }

  /**
   * Query nvidia-smi for attached CUDA GPUs.
   * Returns null if nvidia-smi is not installed or fails.
   */
  async detectNvidia() {
    try {
      const { stdout } = await execFileAsync(
        this.config.nvidiaSmiPath,
        ['--query-gpu=index,name,memory.total,memory.free,memory.used,utilization.gpu,utilization.memory,temperature.gpu,fan.speed,pstate,power.draw,power.limit,pcie.link.gen.max,pcie.link.width.current,compute_cap', '--format=csv,noheader,nounits'],
        { timeout: this.config.timeoutMs, windowsHide: true }
      );

      const header = await this.getNvidiaSmiHeader();

      const gpus = stdout
        .trim()
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => this.parseNvidiaSmiLine(line));

      return {
        driverVersion: header.driverVersion,
        cudaVersion: header.cudaVersion,
        gpus,
      };
    } catch (err) {
      // nvidia-smi not available or no NVIDIA GPU.
      return null;
    }
  }

  /**
   * Parse the free-form nvidia-smi header for driver and CUDA versions.
   */
  async getNvidiaSmiHeader() {
    const result = { driverVersion: null, cudaVersion: null };
    try {
      const { stdout } = await execFileAsync(
        this.config.nvidiaSmiPath,
        [],
        { timeout: this.config.timeoutMs, windowsHide: true }
      );
      const driverMatch = stdout.match(/Driver Version:\s*(\S+)/i);
      if (driverMatch) result.driverVersion = driverMatch[1];
      const cudaMatch = stdout.match(/CUDA Version:\s*(\S+)/i);
      if (cudaMatch) result.cudaVersion = cudaMatch[1];
    } catch {
      // ignore
    }
    return result;
  }

  parseNvidiaSmiLine(line) {
    const parts = line.split(',').map((s) => s.trim());
    const toMiB = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n * 1024 * 1024 : 0;
    };
    const toNumber = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const index = toNumber(parts[0]);
    const name = parts[1] || 'Unknown';
    const memoryTotalMiB = toNumber(parts[2]);
    const memoryFreeMiB = toNumber(parts[3]);
    const memoryUsedMiB = toNumber(parts[4]);
    const computeCap = parts[14] || '0.0';
    const [major, minor] = computeCap.split('.').map(Number);
    const computeCapability = Number.isFinite(major) && Number.isFinite(minor) ? major * 10 + minor : 0;

    return {
      index,
      name,
      vendor: 'NVIDIA',
      cudaCapable: true,
      vramBytes: toMiB(memoryTotalMiB),
      vramFreeBytes: toMiB(memoryFreeMiB),
      vramUsedBytes: toMiB(memoryUsedMiB),
      utilizationGpu: toNumber(parts[5]),
      utilizationMemory: toNumber(parts[6]),
      temperatureC: toNumber(parts[7]),
      fanSpeedPercent: toNumber(parts[8]),
      pState: parts[9] || null,
      powerDrawW: toNumber(parts[10]),
      powerLimitW: toNumber(parts[11]),
      pcieGen: toNumber(parts[12]),
      pcieWidth: toNumber(parts[13]),
      computeCapability: computeCap,
      computeCapabilityNumeric: computeCapability,
      supportsFp16: computeCapability >= 53,
      supportsBf16: computeCapability >= 80,
      supportsInt8: computeCapability >= 35,
      hasTensorCores: computeCapability >= 70,
      memoryBandwidthGBps: null, // requires a device lookup table or NVML
      isHealthy: toNumber(parts[7]) < 95,
    };
  }

  /**
   * OS-level GPU fallback for non-NVIDIA adapters.
   */
  async detectOsGpus() {
    const os = platform();
    try {
      if (os === 'win32') return await this.detectWindowsGpus();
      if (os === 'linux') return await this.detectLinuxGpus();
      if (os === 'darwin') return await this.detectMacGpus();
    } catch (err) {
      // ignore
    }
    return [];
  }

  async detectWindowsGpus() {
    try {
      const { stdout } = await execFileAsync(
        'powershell',
        [
          '-Command',
          'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,Status | ConvertTo-Json -Compress',
        ],
        { timeout: this.config.timeoutMs, windowsHide: true }
      );
      const data = JSON.parse(stdout);
      const rows = Array.isArray(data) ? data : [data];
      return rows
        .filter((g) => g && g.Name)
        .map((g) => ({
          index: 0,
          name: g.Name,
          vendor: this.inferVendor(g.Name),
          cudaCapable: /NVIDIA/i.test(g.Name),
          vramBytes: Number(g.AdapterRAM) || 0,
          vramFreeBytes: null,
          vramUsedBytes: null,
          utilizationGpu: 0,
          utilizationMemory: 0,
          temperatureC: 0,
          fanSpeedPercent: 0,
          powerDrawW: 0,
          powerLimitW: 0,
          pcieGen: null,
          pcieWidth: null,
          computeCapability: null,
          computeCapabilityNumeric: 0,
          supportsFp16: false,
          supportsBf16: false,
          supportsInt8: false,
          hasTensorCores: false,
          memoryBandwidthGBps: null,
          isHealthy: g.Status === 'OK',
        }));
    } catch {
      return [];
    }
  }

  async detectLinuxGpus() {
    try {
      const { stdout } = await execFileAsync(
        'lspci',
        ['-nnk'],
        { timeout: this.config.timeoutMs }
      );
      const gpus = [];
      const vgaRegex = /VGA compatible controller.*?:\s*(.+?)\s*\[/gm;
      let match;
      let index = 0;
      while ((match = vgaRegex.exec(stdout)) !== null) {
        const name = match[1].trim();
        gpus.push({
          index: index++,
          name,
          vendor: this.inferVendor(name),
          cudaCapable: /NVIDIA/i.test(name),
          vramBytes: 0,
          vramFreeBytes: null,
          vramUsedBytes: null,
          isHealthy: true,
        });
      }
      return gpus;
    } catch {
      return [];
    }
  }

  async detectMacGpus() {
    try {
      const { stdout } = await execFileAsync(
        'system_profiler',
        ['SPDisplaysDataType', '-json'],
        { timeout: this.config.timeoutMs }
      );
      const data = JSON.parse(stdout);
      const displays = data?.SPDisplaysDataType || [];
      return displays.map((d, i) => ({
        index: i,
        name: d._name || d.sppci_model || 'Unknown',
        vendor: this.inferVendor(d._name || ''),
        cudaCapable: false, // macOS does not expose CUDA
        vramBytes: 0,
        isHealthy: true,
      }));
    } catch {
      return [];
    }
  }

  inferVendor(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('nvidia')) return 'NVIDIA';
    if (n.includes('amd') || n.includes('radeon')) return 'AMD';
    if (n.includes('intel')) return 'Intel';
    if (n.includes('apple')) return 'Apple';
    return 'Unknown';
  }
}

module.exports = HardwareDiscovery;
