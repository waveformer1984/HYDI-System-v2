import { Platform } from 'react-native';
import { requireOptionalNativeModule, type NativeModule } from 'expo';

type EventSubscription = { remove(): void };

export type ServiceEventType = 'started' | 'start_failed' | 'stopped' | 'talk' | 'stop_talk' | 'leave';

type Events = { onServiceEvent: (e: { type: ServiceEventType }) => void };

declare class WalkieBackgroundNative extends NativeModule<Events> {
  isRunning(): boolean;
  hasMicrophoneType(): boolean;
  start(channelName: string, status: string): void;
  update(status: string, detail: string | null, transmitting: boolean, canTalk: boolean): void;
  stop(): void;
}

// Android only. Absent on iOS, in Expo Go and in Node tests, where every
// call below is a no-op.
const native = Platform.OS === 'android' ? requireOptionalNativeModule<WalkieBackgroundNative>('WalkieBackground') : null;

export const backgroundService = {
  available: native !== null,
  isRunning: () => native?.isRunning() ?? false,
  hasMicrophoneType: () => native?.hasMicrophoneType() ?? false,
  /** Must be called while the app is in the foreground (Android 12+ rule). */
  start: (channelName: string, status: string) => native?.start(channelName, status),
  update: (c: { status: string; detail: string | null; transmitting: boolean; canTalk: boolean }) =>
    native?.update(c.status, c.detail, c.transmitting, c.canTalk),
  stop: () => native?.stop(),
  addListener: (fn: (type: ServiceEventType) => void): EventSubscription | null =>
    native ? native.addListener('onServiceEvent', (e) => fn(e.type)) : null,
};
