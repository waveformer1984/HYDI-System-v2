import { Platform } from 'react-native';
import { requireOptionalNativeModule, type NativeModule } from 'expo';

export type PttEvent =
  | { type: 'joined'; channelId: string; reason: number }
  | { type: 'left'; channelId: string; reason: number }
  | { type: 'transmitBegan'; channelId: string; source: 'user' | 'app' | 'accessory' | 'unknown' }
  | { type: 'transmitEnded'; channelId: string; source: 'user' | 'app' | 'accessory' | 'unknown' }
  | { type: 'pushToken'; token: string }
  | { type: 'pushSpeaker'; channelId: string; speaker: string; speakerUserId?: string }
  | { type: 'pushLeave'; channelId: string }
  | { type: 'audioActivated' }
  | { type: 'audioDeactivated' }
  | { type: 'error'; stage: string; channelId?: string; message: string };

type Events = { onPttEvent: (e: PttEvent) => void };

declare class WalkiePttNative extends NativeModule<Events> {
  activeChannelId(): string | null;
  lastPushToken(): string | null;
  join(channelId: string, name: string): Promise<void>;
  leave(channelId: string): Promise<void>;
  requestBeginTransmitting(channelId: string): Promise<void>;
  stopTransmitting(channelId: string): Promise<void>;
  setActiveRemoteParticipant(channelId: string, name: string | null): Promise<void>;
  setServiceStatus(channelId: string, status: 'ready' | 'connecting' | 'unavailable'): Promise<void>;
}

// iOS only. Absent on Android, in Expo Go and in Node tests (calls no-op).
const native = Platform.OS === 'ios' ? requireOptionalNativeModule<WalkiePttNative>('WalkiePtt') : null;

const ignore = () => {};

export const iosPtt = {
  available: native !== null,
  activeChannelId: () => native?.activeChannelId() ?? null,
  lastPushToken: () => native?.lastPushToken() ?? null,
  /** Needs an explicit user action in the foreground (Apple's rule). */
  join: (channelId: string, name: string) => native?.join(channelId, name) ?? Promise.resolve(),
  leave: (channelId: string) => void native?.leave(channelId).catch(ignore),
  requestBeginTransmitting: (channelId: string) => void native?.requestBeginTransmitting(channelId).catch(ignore),
  stopTransmitting: (channelId: string) => void native?.stopTransmitting(channelId).catch(ignore),
  setActiveRemoteParticipant: (channelId: string, name: string | null) => void native?.setActiveRemoteParticipant(channelId, name).catch(ignore),
  setServiceStatus: (channelId: string, s: 'ready' | 'connecting' | 'unavailable') => void native?.setServiceStatus(channelId, s).catch(ignore),
  addListener: (fn: (e: PttEvent) => void): { remove(): void } | null => (native ? native.addListener('onPttEvent', fn) : null),
};
