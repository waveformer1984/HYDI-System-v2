export * from './types';
export { WatchdogService } from './WatchdogService';

import { getHealthService } from '../health';
import { getMetricsService } from '../metrics';
import { getDefaultJobQueue } from '../jobs';
import { getEventBus } from '../event-bus';
import { WatchdogService } from './WatchdogService';

let defaultWatchdog: WatchdogService | null = null;

export function getWatchdogService(): WatchdogService {
  if (!defaultWatchdog) {
    defaultWatchdog = new WatchdogService({
      healthService: getHealthService(),
      metricsService: getMetricsService(),
      jobQueue: getDefaultJobQueue(),
      eventBus: getEventBus(),
    });
  }
  return defaultWatchdog;
}
