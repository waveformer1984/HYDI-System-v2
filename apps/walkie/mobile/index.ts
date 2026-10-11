import { registerGlobals } from '@livekit/react-native';
import { registerRootComponent } from 'expo';

import App from './App';

// WebRTC globals for livekit-client. Must run before any LiveKit code.
registerGlobals();

registerRootComponent(App);
