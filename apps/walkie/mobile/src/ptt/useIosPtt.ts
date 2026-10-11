import { useCallback, useEffect, useRef, useState } from 'react';
import { RTCAudioSession } from '@livekit/react-native-webrtc';
import { iosPtt, type PttEvent } from '../../modules/walkie-ptt/src';
import type { Api } from '../api';
import { config } from '../config';
import { setIosAudioMode } from './ios-audio-mode';
import { AUDIO_ACTIVATION_TIMEOUT_MS, onStateChange, onSystemTransmit, type PttAction } from './ios-ptt-policy';
import type { PttState } from './machine';
import type { useChannelSession } from './useChannelSession';

export type IosPttStatus = 'unavailable' | 'off' | 'joining' | 'on';

type Session = ReturnType<typeof useChannelSession>;

/**
 * Milestone 3 (iOS): lock-screen / background push-to-talk through Apple's
 * PushToTalk framework. The user turns it on per channel with an explicit
 * tap (Apple requires a foreground user action to join). While joined:
 * - the system owns the audio session; the mic opens only after
 *   didActivate, which is forwarded to WebRTC;
 * - Talk in the system UI starts a latched turn through the same server
 *   arbitration; releasing or losing the turn stops the system transmission;
 * - the server pushes `pushtotalk` notifications to wake this phone when
 *   someone else starts talking.
 * One PTT channel at a time: opening another channel's screen while joined
 * elsewhere leaves the old one.
 */
export function useIosPtt(session: Session, opts: { api: Api; channelId: string; channelName: string; nameOf: (id: string) => string }) {
  const { state, selfId } = session;
  const supported = iosPtt.available && config.iosPtt;
  const [status, setStatus] = useState<IosPttStatus>(() => (!supported ? 'unavailable' : iosPtt.activeChannelId() === opts.channelId ? 'on' : 'off'));
  const [error, setError] = useState<string | null>(null);
  const audioActive = useRef(false);
  const waiters = useRef<Array<(ok: boolean) => void>>([]);
  const prevState = useRef<PttState>(state);
  const latest = useRef({ session, opts });
  latest.current = { session, opts };

  const perform = useCallback((actions: PttAction[]) => {
    const { session: s, opts: o } = latest.current;
    for (const a of actions) {
      if (a.type === 'pressLatched') s.pressLatched();
      else if (a.type === 'release') s.release();
      else if (a.type === 'stopTransmitting') iosPtt.stopTransmitting(o.channelId);
      else iosPtt.setActiveRemoteParticipant(o.channelId, a.name);
    }
  }, []);

  const registerToken = useCallback(async (token: string) => {
    const { opts: o } = latest.current;
    try {
      await o.api.setPttToken(o.channelId, token, config.apnsEnvironment);
    } catch {
      setError('Could not register this phone for lock-screen talk. It will retry when you reopen the channel.');
    }
  }, []);

  // Native events.
  useEffect(() => {
    if (!supported) return;
    const sub = iosPtt.addListener((e: PttEvent) => {
      const { session: s, opts: o } = latest.current;
      const mine = 'channelId' in e ? e.channelId === o.channelId : true;
      switch (e.type) {
        case 'joined':
          if (!mine) return;
          setIosAudioMode('ptt');
          setStatus('on');
          setError(null);
          {
            const t = iosPtt.lastPushToken();
            if (t) void registerToken(t);
          }
          return;
        case 'left':
        case 'pushLeave':
          if (!mine) return;
          setIosAudioMode('livekit');
          setStatus('off');
          void o.api.deletePttToken(o.channelId).catch(() => {});
          return;
        case 'pushToken':
          if (iosPtt.activeChannelId() === o.channelId) void registerToken(e.token);
          return;
        case 'transmitBegan':
        case 'transmitEnded':
          if (!mine) return;
          perform(onSystemTransmit(e.type === 'transmitBegan' ? 'began' : 'ended', e.source, s.state));
          return;
        case 'audioActivated':
          RTCAudioSession.audioSessionDidActivate();
          audioActive.current = true;
          waiters.current.splice(0).forEach((w) => w(true));
          return;
        case 'audioDeactivated':
          RTCAudioSession.audioSessionDidDeactivate();
          audioActive.current = false;
          return;
        case 'error':
          if (e.stage === 'join') setStatus('off');
          setError(`Lock-screen talk: ${e.message}`);
          return;
        case 'pushSpeaker':
          return; // the system UI already shows the speaker; the room connection follows
      }
    });
    return () => sub?.remove();
  }, [supported, perform, registerToken]);

  // Mic gate: while joined, wait for the system to activate audio.
  useEffect(() => {
    if (status !== 'on') {
      session.setMicGate(null);
      return;
    }
    session.setMicGate(
      () =>
        new Promise<boolean>((resolve) => {
          if (audioActive.current) return resolve(true);
          const t = setTimeout(() => {
            waiters.current = waiters.current.filter((w) => w !== done);
            resolve(false);
          }, AUDIO_ACTIVATION_TIMEOUT_MS);
          const done = (ok: boolean) => {
            clearTimeout(t);
            resolve(ok);
          };
          waiters.current.push(done);
        }),
    );
    return () => session.setMicGate(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // State-driven reactions (stop system transmission, system UI speaker).
  useEffect(() => {
    const prev = prevState.current;
    prevState.current = state;
    if (status !== 'on') return;
    perform(onStateChange(prev, state, selfId, opts.nameOf));
  }, [state, status, selfId, opts.nameOf, perform]);

  // Report connection health to the system UI.
  useEffect(() => {
    if (status !== 'on') return;
    const s = state.connection === 'connected' ? 'ready' : state.connection === 'disconnected' ? 'unavailable' : 'connecting';
    iosPtt.setServiceStatus(opts.channelId, s);
  }, [state.connection, status, opts.channelId]);

  // One PTT channel at a time.
  useEffect(() => {
    if (!supported) return;
    const active = iosPtt.activeChannelId();
    if (active && active !== opts.channelId) iosPtt.leave(active);
  }, [supported, opts.channelId]);

  const enable = useCallback(async () => {
    if (!supported) return;
    setStatus('joining');
    setError(null);
    try {
      await iosPtt.join(latest.current.opts.channelId, latest.current.opts.channelName);
    } catch (err) {
      setStatus('off');
      setError(err instanceof Error ? err.message : 'Could not turn on lock-screen talk.');
    }
  }, [supported]);

  const disable = useCallback(() => {
    iosPtt.leave(latest.current.opts.channelId);
  }, []);

  /** On-screen press while joined also asks the system to transmit (so it activates audio). */
  const press = useCallback(() => {
    const { session: s, opts: o } = latest.current;
    s.press();
    if (status === 'on') iosPtt.requestBeginTransmitting(o.channelId);
  }, [status]);

  return { status, error, enable, disable, press, release: session.release };
}
