import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import type { GpuDevice, GpuHealth, HealthCollector, HealthSnapshot } from '../types';

const exec = promisify(execCallback);

export class GpuHealthCollector implements HealthCollector {
  readonly name = 'gpu';

  async collect(): Promise<Partial<HealthSnapshot>> {
    const gpu = await this.buildGpuHealth();
    return { gpu };
  }

  private async buildGpuHealth(): Promise<GpuHealth> {
    let devices: GpuDevice[] = [];

    try {
      const nvidia = await this.collectNvidia();
      if (nvidia.length > 0) {
        devices = nvidia;
      } else {
        devices = await this.collectWmic();
      }
    } catch (error) {
      return {
        status: 'unavailable',
        devices: [],
        error: error instanceof Error ? error.message : 'GPU detection failed',
      };
    }

    if (devices.length === 0) {
      return { status: 'unknown', devices: [] };
    }

    const hasUtilization = devices.some(
      (d) => typeof d.utilizationPercent === 'number' && d.utilizationPercent !== null
    );

    return {
      status: hasUtilization ? 'healthy' : 'degraded',
      devices,
      error: hasUtilization ? undefined : 'GPU utilization not available on this device',
    };
  }

  private async collectNvidia(): Promise<GpuDevice[]> {
    try {
      const { stdout } = await exec(
        'nvidia-smi --query-gpu=name,memory.total,utilization.gpu,temperature.gpu --format=csv,noheader,nounits',
        { timeout: 3000 }
      );

      return stdout
        .trim()
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          const [name, vramMb, util, temp] = line.split(',').map((s) => s.trim());
          return {
            name,
            vendor: 'NVIDIA',
            vramBytes: parseInt(vramMb, 10) * 1024 * 1024 || undefined,
            utilizationPercent: util ? parseFloat(util) : null,
            temperatureC: temp ? parseFloat(temp) : null,
          };
        });
    } catch {
      return [];
    }
  }

  private async collectWmic(): Promise<GpuDevice[]> {
    if (process.platform !== 'win32') return [];

    try {
      const { stdout } = await exec(
        'wmic path win32_VideoController get Name,AdapterRAM,Status /format:csv',
        { timeout: 3000 }
      );

      const lines = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('Node'));

      return lines.map((line) => {
        // CSV format: NODE,Caption,Status,Name,AdapterRAM
        const parts = line.split(',');
        const name = parts[parts.length - 2]?.trim() || 'Unknown GPU';
        const rawRam = parts[parts.length - 1]?.trim() || '0';
        const vramBytes = parseInt(rawRam, 10) || undefined;
        return { name, vendor: 'Unknown', vramBytes, utilizationPercent: null, temperatureC: null };
      });
    } catch {
      return [];
    }
  }
}
