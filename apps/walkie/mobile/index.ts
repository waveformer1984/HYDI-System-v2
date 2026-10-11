import { registerGlobals } from '@livekit/react-native';
import { registerRootComponent } from 'expo';

import App from './App';
import { iosPtt } from './modules/walkie-ptt/src';
import { setIosAudioMode } from './src/ptt/ios-audio-mode';

// WebRTC globals for livekit-client. Must run before any LiveKit code.
// iOS audio-session management is switched explicitly (setIosAudioMode) so it
// can be handed to the PushToTalk framework while a PTT channel is joined.
registerGlobals({ autoConfigureAudioSession: false });
setIosAudioMode(iosPtt.activeChannelId() ? 'ptt' : 'livekit');

registerRootComponent(App);
