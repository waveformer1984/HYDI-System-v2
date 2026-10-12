import type { ExpoConfig } from 'expo/config';

// APP_VARIANT=development builds talk to a LAN backend over plain http/ws, so
// they allow cleartext traffic. Every other variant requires https/wss.
const DEV = process.env.APP_VARIANT === 'development';
// Milestone 3: build with Apple's PushToTalk capability. Requires an Apple
// Developer team whose app ID has the Push to Talk capability enabled;
// signing fails without it, so it is opt-in.
const IOS_PTT = process.env.WALKIE_IOS_PTT === '1';
const APNS_ENV = process.env.WALKIE_APNS_ENV === 'production' || (!DEV && process.env.WALKIE_APNS_ENV !== 'sandbox') ? 'production' : 'sandbox';

const MIC_EXPLANATION =
  'Walkie uses the microphone only during a speaking turn the channel has given you: while you hold the Talk button, ' +
  'or after you tap Talk in the Walkie notification (until you tap Stop or the maximum talk time ends). ' +
  'Nothing is recorded or transcribed.';

const config: ExpoConfig = {
  name: DEV ? 'Walkie (dev)' : 'ProtoForge Walkie',
  slug: 'protoforge-walkie',
  scheme: 'protoforgewalkie',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: DEV ? 'com.protoforge.walkie.dev' : 'com.protoforge.walkie',
    supportsTablet: false,
    infoPlist: {
      NSMicrophoneUsageDescription: MIC_EXPLANATION,
      // Development builds reach a LAN backend over http/ws.
      ...(DEV ? { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } : {}),
      // Milestone 3: background/lock-screen audio only through Apple's
      // PushToTalk framework, and only in builds made with WALKIE_IOS_PTT=1.
      ...(IOS_PTT ? { UIBackgroundModes: ['push-to-talk'] } : {}),
    },
    ...(IOS_PTT
      ? {
          entitlements: {
            'com.apple.developer.push-to-talk': true,
            'aps-environment': APNS_ENV === 'production' ? 'production' : 'development',
          },
        }
      : {}),
  },
  android: {
    package: DEV ? 'com.protoforge.walkie.dev' : 'com.protoforge.walkie',
    adaptiveIcon: {
      backgroundColor: '#0B1220',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS', 'android.permission.BLUETOOTH_CONNECT'],
    // The WebRTC plugin adds these by default; walkie never uses the camera
    // or draws over other apps.
    blockedPermissions: [
      'android.permission.CAMERA',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    ['@livekit/react-native-expo-plugin', { android: { audioType: 'communication' } }],
    ['@config-plugins/react-native-webrtc', { microphonePermission: MIC_EXPLANATION }],
    'expo-secure-store',
    ['expo-build-properties', { android: { usesCleartextTraffic: DEV } }],
  ],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_WALKIE_API_URL,
    authMode: process.env.EXPO_PUBLIC_WALKIE_AUTH_MODE ?? 'supabase',
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    // The anon (publishable) key is designed to ship in apps. No secret goes here.
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    iosPtt: IOS_PTT,
    apnsEnvironment: APNS_ENV,
  },
};

export default config;
