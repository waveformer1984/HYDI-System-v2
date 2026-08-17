// UNIFIED EXECUTION PHILOSOPHY - Single source of truth configuration

import { access } from 'fs/promises';

export type ExecutionMode = 'redis' | 'file';

export interface SystemConfig {
  execution_mode: ExecutionMode;
  consistency_guarantees: 'strict_atomic' | 'eventual_consistency';
  infrastructure_requirements: string[];
  fallback_behavior: 'graceful_degradation' | 'fail_fast';
}

export const SYSTEM_CONFIGS: Record<ExecutionMode, SystemConfig> = {
  redis: {
    execution_mode: 'redis',
    consistency_guarantees: 'strict_atomic',
    infrastructure_requirements: ['redis_server', 'redis_connection'],
    fallback_behavior: 'graceful_degradation'
  },
  file: {
    execution_mode: 'file',
    consistency_guarantees: 'eventual_consistency',
    infrastructure_requirements: ['file_system', 'write_permissions'],
    fallback_behavior: 'fail_fast'
  }
};

export function getSystemConfig(): SystemConfig {
  // Auto-detect based on environment
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require('@upstash/redis');
    const redis = Redis.fromEnv();
    // If Redis initialization succeeds, use Redis mode
    return SYSTEM_CONFIGS.redis;
  } catch (error) {
    // Redis not available, use file mode
    return SYSTEM_CONFIGS.file;
  }
}

export function validateSystemConfig(config: SystemConfig): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  // Check infrastructure requirements
  if (config.execution_mode === 'redis') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Redis } = require('@upstash/redis');
      const redis = Redis.fromEnv();
      // Test connection
      redis.ping().catch(() => {
        issues.push('Redis connection failed');
      });
    } catch {
      issues.push('Redis not available');
    }
  }
  
  if (config.execution_mode === 'file') {
    try {
      access('./data/tasks.json');
    } catch {
      issues.push('File system not accessible');
    }
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}
