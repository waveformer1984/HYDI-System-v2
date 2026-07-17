import { promises as fs } from 'fs';
import os from 'os';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import type { HealthCollector, HealthSnapshot, SystemHealth } from '../types';

const exec = promisify(execCallback);

interface CpuSample {
  timestamp: number;
  totalIdle: number;
  total: number;
}

export class SystemHealthCollector implements HealthCollector {
  readonly name = 'system';
  private lastCpuSample: CpuSample | null = null;

  async collect(): Promise<Partial<HealthSnapshot>> {
    const buildVersion = await this.getBuildVersion();
    const system = await this.buildSystemHealth(buildVersion);
    return { version: buildVersion, system };
  }

  private async buildSystemHealth(buildVersion: string): Promise<SystemHealth> {
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const processMemory = process.memoryUsage();

    const cpuUsage = this.computeCpuUsage(cpus);
    const gitCommit = await this.getGitCommit();
    const disks = await this.getDiskUsage();

    return {
      cpu: {
        usagePercent: cpuUsage,
        loadAverage: os.loadavg(),
        cores: cpus.length,
        speedMhz: cpus[0]?.speed ?? null,
      },
      memory: {
        totalBytes: totalMemory,
        freeBytes: freeMemory,
        usedBytes: totalMemory - freeMemory,
        processUsedBytes: processMemory.rss,
        usagePercent: totalMemory > 0 ? ((totalMemory - freeMemory) / totalMemory) * 100 : 0,
      },
      disks,
      uptimeSeconds: process.uptime(),
      nodeVersion: process.version,
      gitCommit,
      buildVersion,
      platform: process.platform,
      hostname: os.hostname(),
    };
  }

  /**
   * Compute system-wide CPU usage by comparing two os.cpus() samples. The first
   * call returns null because no baseline exists; subsequent calls within the
   * same process produce a real percentage.
   */
  private computeCpuUsage(cpus: os.CpuInfo[]): number | null {
    let totalIdle = 0;
    let total = 0;

    for (const cpu of cpus) {
      const times = cpu.times;
      totalIdle += times.idle;
      total += times.user + times.nice + times.sys + times.idle + times.irq;
    }

    const now = Date.now();
    const sample: CpuSample = { timestamp: now, totalIdle, total };

    if (!this.lastCpuSample) {
      this.lastCpuSample = sample;
      return null;
    }

    const last = this.lastCpuSample;
    const totalDelta = total - last.total;
    const idleDelta = totalIdle - last.totalIdle;
    const timeDelta = now - last.timestamp;

    // Reuse the sample only if it is fresh enough to be meaningful.
    this.lastCpuSample = sample;

    if (totalDelta <= 0 || timeDelta > 30000) {
      return null;
    }

    const usage = 100 - (idleDelta / totalDelta) * 100;
    return Math.max(0, Math.min(100, Number(usage.toFixed(2))));
  }

  private async getGitCommit(): Promise<string> {
    try {
      const { stdout } = await exec('git rev-parse --short HEAD', { timeout: 2000 });
      return stdout.trim();
    } catch {
      try {
        const head = await fs.readFile('.git/HEAD', 'utf8');
        return head.trim().slice(0, 12) || 'unknown';
      } catch {
        return 'unknown';
      }
    }
  }

  private async getBuildVersion(): Promise<string> {
    try {
      const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
      return pkg.version ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private async getDiskUsage(): Promise<SystemHealth['disks']> {
    const paths = this.getDiskPaths();
    const results: SystemHealth['disks'] = [];
    const seen = new Set<string>();

    for (const path of paths) {
      if (seen.has(path)) continue;
      seen.add(path);

      try {
        const stat = await fs.statfs(path);
        const total = stat.blocks * stat.bsize;
        const free = stat.bavail * stat.bsize;
        const used = total - free;
        results.push({
          path,
          totalBytes: total,
          freeBytes: free,
          usagePercent: total > 0 ? (used / total) * 100 : 0,
        });
      } catch {
        // Skip inaccessible mount points silently.
      }
    }

    return results;
  }

  private getDiskPaths(): string[] {
    if (process.platform === 'win32') {
      const cwd = process.cwd();
      const drive = cwd[0] + ':/';
      return [drive, 'C:/'];
    }
    return [process.cwd(), '/'];
  }
}
