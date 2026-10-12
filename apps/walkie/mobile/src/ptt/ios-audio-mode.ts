import { Platform } from 'react-native';
import { setupIOSAudioManagement } from '@livekit/react-native';

/**
 * Who owns the iOS audio session.
 * - 'livekit': the SDK's default automatic management (what registerGlobals()
 *   does by default). Used unless a PushToTalk channel is joined.
 * - 'ptt': the PushToTalk framework activates the session (Apple requires
 *   this while joined); the app forwards didActivate/didDeactivate to WebRTC.
 */
let cleanup: (() => void) | null = null;
let mode: 'livekit' | 'ptt' | null = null;

export function setIosAudioMode(next: 'livekit' | 'ptt') {
  if (Platform.OS !== 'ios' || next === mode) return;
  mode = next;
  if (next === 'livekit') {
    cleanup = setupIOSAudioManagement();
  } else {
    cleanup?.();
    cleanup = null;
  }
}

export const iosAudioMode = () => mode;
