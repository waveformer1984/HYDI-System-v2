export * from './types';
export { EventBus } from './EventBus';

import { EventBus } from './EventBus';

let defaultBus: EventBus | null = null;
let defaultRecorder: unknown = null;

export function getEventBus(): EventBus {
  if (!defaultBus) {
    defaultBus = new EventBus({
      maxHistory: 5000,
      logToConsole: process.env.NODE_ENV !== 'test',
    });
  }
  return defaultBus;
}

export function setEventRecorder(recorder: unknown): void {
  defaultRecorder = recorder;
}

export function getEventRecorder(): unknown {
  return defaultRecorder;
}
