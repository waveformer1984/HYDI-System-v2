export * from './types';
export * from './utils';
export { HealthService, createHealthService } from './HealthService';
export { HealthPoller } from './HealthPoller';
export * from './collectors';

import { HealthService } from './HealthService';
import { createHealthService } from './HealthService';

let defaultHealthService: HealthService | null = null;

export function getHealthService(): HealthService {
  if (!defaultHealthService) {
    defaultHealthService = createHealthService();
  }
  return defaultHealthService;
}
