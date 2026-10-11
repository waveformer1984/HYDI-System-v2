import { useEffect, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { backgroundService } from '../../modules/walkie-background/src';
import { notificationContent } from './notification';
import type { useChannelSession } from './useChannelSession';

export type BackgroundStatus = 'unavailable' | 'off' | 'starting' | 'on' | 'failed';

type Session = ReturnType<typeof useChannelSession>;

/**
 * Milestone 2 (Android): keeps a joined channel connected while the app is
 * in the background, through a foreground service with a persistent
 * notification. The service is started only while the app is visible and
 * after the room connects. It stops when the user leaves the channel or
 * turns the option off.
 */
export function useBackgroundService(
  session: Session,
  opts: { enabled: boolean; channelName: string; speakerName: string | null; onLeave: () => void },
) {
  const { state, selfId } = session;
  const [status, setStatus] = useState<BackgroundStatus>(backgroundService.available ? 'off' : 'unavailable');
  const [notificationsBlocked, setNotificationsBlocked] = useState(false);
  const last = useRef('');
  const handlers = useRef({ session, onLeave: opts.onLeave });
  handlers.current = { session, onLeave: opts.onLeave };

  // Service events → session.
  useEffect(() => {
    const sub = backgroundService.addListener((type) => {
      const { session: s, onLeave } = handlers.current;
      switch (type) {
        case 'started':
          s.setKeepAliveInBackground(true);
          setStatus('on');
          return;
        case 'start_failed':
          s.setKeepAliveInBackground(false);
          setStatus('failed');
          return;
        case 'stopped':
          s.setKeepAliveInBackground(false);
          setStatus((cur) => (cur === 'failed' ? cur : 'off'));
          return;
        case 'talk':
          s.pressLatched();
          return;
        case 'stop_talk':
          s.release();
          return;
        case 'leave':
          onLeave();
          return;
      }
    });
    return () => sub?.remove();
  }, []);

  // Start once the room is connected and the app is visible; stop when disabled.
  const connected = state.connection === 'connected';
  useEffect(() => {
    if (!backgroundService.available) return;
    if (!opts.enabled) {
      backgroundService.stop();
      session.setKeepAliveInBackground(false);
      setStatus('off');
      return;
    }
    if (!connected || backgroundService.isRunning() || AppState.currentState !== 'active') return;
    let cancelled = false;
    void (async () => {
      if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
        const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => 'denied');
        // The service runs either way; without this permission Android hides
        // its notification (it still appears in the system's task manager).
        setNotificationsBlocked(r !== PermissionsAndroid.RESULTS.GRANTED);
      }
      if (cancelled || AppState.currentState !== 'active') return;
      setStatus('starting');
      last.current = '';
      backgroundService.start(opts.channelName, 'Listening');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, connected, opts.channelName]);

  // Microphone granted after the service started without it: restart it in
  // the foreground so it gains the microphone type (needed to transmit from
  // the background).
  useEffect(() => {
    if (state.mic !== 'granted' || !backgroundService.isRunning() || backgroundService.hasMicrophoneType()) return;
    if (AppState.currentState !== 'active') return;
    backgroundService.start(opts.channelName, 'Listening');
    last.current = '';
  }, [state.mic, status, opts.channelName]);

  // Keep the notification in step with the session.
  useEffect(() => {
    if (status !== 'on') return;
    const content = notificationContent(state, selfId, opts.speakerName);
    const key = JSON.stringify(content);
    if (key === last.current) return;
    last.current = key;
    backgroundService.update(content);
  }, [state, selfId, opts.speakerName, status]);

  // Leaving the channel screen ends the background session.
  useEffect(
    () => () => {
      backgroundService.stop();
    },
    [],
  );

  return { status, notificationsBlocked };
}
