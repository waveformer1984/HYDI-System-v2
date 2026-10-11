import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform, Vibration } from 'react-native';
import { AudioSession } from '@livekit/react-native';
import { permissions } from '@livekit/react-native-webrtc';
import { ConnectionState, DisconnectReason, Room, RoomEvent, Track, type Participant } from 'livekit-client';
import { ApiError, type Api } from '../api';
import { releaseOnBackground } from './notification';
import { initialState, reduce, type Connection, type Effect, type PttEvent, type PttState } from './machine';

export interface Presence {
  identity: string;
  name: string;
  speaking: boolean;
}

export interface TurnTiming {
  pressToGrantMs: number;
  grantToMicLiveMs: number;
}

export type EndReason = 'removed' | 'channel_gone' | null;

/**
 * Owns one channel session: the LiveKit room, the speaking-turn lease and the
 * microphone. All talk decisions go through the pure state machine; this hook
 * only performs its effects and translates SDK/network events into machine
 * events.
 */
export function useChannelSession(api: Api, channelId: string, selfId: string) {
  const [state, setState] = useState<PttState>(initialState);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [timing, setTiming] = useState<TurnTiming | null>(null);
  const [ended, setEnded] = useState<EndReason>(null);
  const [outputs, setOutputs] = useState<string[]>([]);

  const stateRef = useRef(state);
  const roomRef = useRef<Room | null>(null);
  const micChain = useRef<Promise<void>>(Promise.resolve());
  const renew = useRef<{ timer: ReturnType<typeof setInterval> | null; lastOk: number; ttl: number }>({ timer: null, lastOk: 0, ttl: 5000 });
  const sawPublishGrant = useRef(false);
  const pressAt = useRef(0);
  const grantAt = useRef(0);
  const alive = useRef(true);
  // Milestone 2: a turn started from the background notification has no
  // finger on a button, so it is "latched" until Stop, max duration or loss.
  const latched = useRef(false);
  // True while the Android foreground service keeps this session alive.
  const keepAliveInBackground = useRef(false);

  const dispatch = useCallback((ev: PttEvent) => {
    const [next, effects] = reduce(stateRef.current, ev);
    stateRef.current = next;
    if (!next.pressed) latched.current = false;
    setState(next);
    for (const e of effects) run(e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Microphone operations are strictly serialised: a stop issued while a
  // start is still in progress runs after it, so the mic can never be left on.
  const micOp = (fn: () => Promise<void>) => {
    micChain.current = micChain.current.then(fn).catch(() => {});
  };

  const stopRenewing = () => {
    if (renew.current.timer) clearInterval(renew.current.timer);
    renew.current.timer = null;
  };

  function run(e: Effect) {
    const room = roomRef.current;
    switch (e.type) {
      case 'requestMicPermission':
        void (async () => {
          try {
            const r = await permissions.request({ name: 'microphone' });
            dispatch({ type: 'MIC_PERMISSION', state: r === true || r === 'granted' ? 'granted' : 'denied' });
          } catch {
            dispatch({ type: 'MIC_PERMISSION', state: 'denied' });
          }
        })();
        return;

      case 'requestTurn':
        pressAt.current = Date.now();
        void (async () => {
          try {
            const g = await api.requestTalk(channelId);
            grantAt.current = Date.now();
            renew.current.ttl = Math.max(1000, g.renewDeadline - g.grantedAt);
            sawPublishGrant.current = Boolean(room?.localParticipant.permissions?.canPublish);
            dispatch({ type: 'GRANTED', leaseId: g.leaseId, until: Date.now() + g.maxMs });
          } catch (err) {
            if (err instanceof ApiError && err.status === 409 && err.code === 'busy') {
              const sp = err.body.speaker as { userId?: string } | undefined;
              dispatch({ type: 'DENIED_BUSY', speakerId: sp?.userId ?? '' });
            } else if (err instanceof ApiError && err.status === 429) {
              dispatch({ type: 'DENIED_RATE_LIMIT', retryAfterMs: Number(err.body.retryAfterMs ?? 1000), now: Date.now() });
            } else {
              dispatch({ type: 'DENIED_ERROR' });
            }
          }
        })();
        return;

      case 'startMic':
        micOp(async () => {
          if (!room) return;
          try {
            await room.localParticipant.setMicrophoneEnabled(true);
            setTiming({ pressToGrantMs: grantAt.current - pressAt.current, grantToMicLiveMs: Date.now() - grantAt.current });
          } catch (err) {
            const name = err instanceof Error ? err.name : '';
            if (name === 'NotAllowedError' || name === 'PermissionDeniedError') dispatch({ type: 'MIC_PERMISSION', state: 'denied' });
            else dispatch({ type: 'TURN_LOST', reason: 'turn_ended' });
          }
        });
        return;

      case 'stopMic':
        micOp(async () => {
          if (!room) return;
          const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
          // Unpublish and stop the capture track so the OS microphone
          // indicator goes off, not just a mute.
          if (pub?.track) await room.localParticipant.unpublishTrack(pub.track, true);
        });
        return;

      case 'startRenewing': {
        stopRenewing();
        renew.current.lastOk = Date.now();
        const every = Math.max(250, Math.floor(renew.current.ttl / 3));
        renew.current.timer = setInterval(() => {
          // If we cannot reach the server for a whole TTL, the server has
          // already ended the turn: stop transmitting locally too.
          if (Date.now() - renew.current.lastOk > renew.current.ttl) {
            dispatch({ type: 'TURN_LOST', reason: 'turn_ended' });
            return;
          }
          api.renewTalk(channelId, e.leaseId).then(
            () => {
              renew.current.lastOk = Date.now();
            },
            (err) => {
              if (err instanceof ApiError && (err.status === 410 || err.status === 404)) dispatch({ type: 'TURN_LOST', reason: 'turn_ended' });
            },
          );
        }, every);
        return;
      }

      case 'stopRenewing':
        stopRenewing();
        return;

      case 'releaseTurn':
        api.releaseTalk(channelId, e.leaseId).catch(() => {
          // One retry; after that the server's renew timeout reclaims it.
          setTimeout(() => api.releaseTalk(channelId, e.leaseId).catch(() => {}), 1000);
        });
        return;

      case 'haptic':
        Vibration.vibrate(e.kind === 'granted' ? 40 : e.kind === 'denied' ? [0, 30, 60, 30] : 20);
        return;
    }
  }

  const refreshPresence = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const ps: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
    setPresence(ps.map((p) => ({ identity: p.identity, name: p.name || p.identity, speaking: p.isSpeaking })));
  }, []);

  const refreshOutputs = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    try {
      setOutputs(await AudioSession.getAudioOutputs());
    } catch {
      setOutputs([]);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const tick = setInterval(() => dispatch({ type: 'TICK', now: Date.now() }), 250);

    const mapConn = (s: ConnectionState): Connection =>
      s === ConnectionState.Connected
        ? 'connected'
        : s === ConnectionState.Connecting
          ? 'connecting'
          : s === ConnectionState.Disconnected
            ? 'disconnected'
            : 'reconnecting';

    async function connect() {
      if (!alive.current) return;
      dispatch({ type: 'CONNECTION', state: attempt === 0 ? 'connecting' : 'reconnecting' });
      try {
        const c = await api.connection(channelId);
        const room = new Room({ adaptiveStream: false, dynacast: false, stopLocalTrackOnUnpublish: true });
        roomRef.current = room;
        room
          .on(RoomEvent.ConnectionStateChanged, (s) => dispatch({ type: 'CONNECTION', state: mapConn(s) }))
          .on(RoomEvent.ParticipantConnected, refreshPresence)
          .on(RoomEvent.ParticipantDisconnected, refreshPresence)
          .on(RoomEvent.ActiveSpeakersChanged, refreshPresence)
          .on(RoomEvent.RoomMetadataChanged, (md) => {
            try {
              const sp = (JSON.parse(md) as { speaker?: { userId: string; until: number } | null }).speaker ?? null;
              dispatch({ type: 'SPEAKER', speaker: sp });
            } catch {
              /* ignore malformed metadata */
            }
          })
          .on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant) => {
            if (participant !== room.localParticipant) return;
            const can = Boolean(room.localParticipant.permissions?.canPublish);
            if (can) sawPublishGrant.current = true;
            // Only a revocation that follows this turn's grant ends the turn;
            // an older revocation can arrive late on the signalling channel.
            else if (sawPublishGrant.current && stateRef.current.talk.kind === 'speaking') {
              sawPublishGrant.current = false;
              dispatch({ type: 'TURN_LOST', reason: 'turn_ended' });
            }
          })
          .on(RoomEvent.Disconnected, (reason) => {
            dispatch({ type: 'CONNECTION', state: 'disconnected' });
            if (reason === DisconnectReason.PARTICIPANT_REMOVED) setEnded('removed');
            else if (reason === DisconnectReason.ROOM_DELETED) setEnded('channel_gone');
            else if (reason !== DisconnectReason.CLIENT_INITIATED) scheduleReconnect();
          });
        await room.connect(c.url, c.token, { autoSubscribe: true });
        attempt = 0;
        const md = room.metadata;
        if (md) room.emit(RoomEvent.RoomMetadataChanged, md);
        refreshPresence();
        void refreshOutputs();
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setEnded('removed');
          dispatch({ type: 'CONNECTION', state: 'disconnected' });
          return;
        }
        dispatch({ type: 'CONNECTION', state: 'disconnected' });
        scheduleReconnect();
      }
    }

    function scheduleReconnect() {
      if (!alive.current || retryTimer) return;
      const delay = Math.min(15_000, 500 * 2 ** attempt++);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        const old = roomRef.current;
        roomRef.current = null;
        void old?.disconnect();
        void connect();
      }, delay);
    }

    void (async () => {
      // Speakerphone by default, but headsets and Bluetooth take priority.
      await AudioSession.configureAudio({
        android: {
          preferredOutputList: ['bluetooth', 'headset', 'speaker', 'earpiece'],
          audioTypeOptions: { manageAudioFocus: true, audioMode: 'inCommunication', audioFocusMode: 'gain', audioStreamType: 'voiceCall', audioAttributesUsageType: 'voiceCommunication', audioAttributesContentType: 'speech' },
        },
        ios: { defaultOutput: 'speaker' },
      }).catch(() => {});
      await AudioSession.startAudioSession().catch(() => {});
      if (Platform.OS === 'android' && Number(Platform.Version) >= 31) {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT).catch(() => {});
      }
      try {
        const q = await permissions.query({ name: 'microphone' });
        dispatch({ type: 'MIC_PERMISSION', state: q === 'granted' ? 'granted' : q === 'denied' ? 'denied' : 'unknown' });
      } catch {
        /* stays unknown; asked on first press */
      }
      await connect();
    })();

    // Leaving the app ends an on-screen press. Only a turn latched from the
    // background notification, with the foreground service running,
    // survives backgrounding.
    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') return;
      if (releaseOnBackground({ pressed: stateRef.current.pressed, keepAlive: keepAliveInBackground.current, latched: latched.current })) {
        dispatch({ type: 'RELEASE' });
      }
    });

    return () => {
      alive.current = false;
      if (stateRef.current.talk.kind === 'speaking' || stateRef.current.pressed) dispatch({ type: 'RELEASE' });
      clearInterval(tick);
      if (retryTimer) clearTimeout(retryTimer);
      stopRenewing();
      appState.remove();
      const room = roomRef.current;
      roomRef.current = null;
      micChain.current.finally(() => {
        void room?.disconnect();
        void AudioSession.stopAudioSession();
      });
    };
  }, [api, channelId, dispatch, refreshPresence, refreshOutputs]);

  const press = useCallback(() => dispatch({ type: 'PRESS', now: Date.now() }), [dispatch]);
  const release = useCallback(() => dispatch({ type: 'RELEASE' }), [dispatch]);
  /** Talk from the background notification: latched until Stop, max duration or loss of the turn. */
  const pressLatched = useCallback(() => {
    if (stateRef.current.pressed) return;
    latched.current = true;
    dispatch({ type: 'PRESS', now: Date.now() });
  }, [dispatch]);
  const setKeepAliveInBackground = useCallback((on: boolean) => {
    keepAliveInBackground.current = on;
  }, []);
  const retryMicPermission = useCallback(() => {
    dispatch({ type: 'MIC_PERMISSION', state: 'unknown' });
  }, [dispatch]);
  const selectOutput = useCallback(async (id: string) => {
    if (Platform.OS === 'ios') await AudioSession.showAudioRoutePicker();
    else await AudioSession.selectAudioOutput(id);
  }, []);

  return {
    state,
    presence,
    timing,
    ended,
    outputs,
    refreshOutputs,
    selectOutput,
    press,
    release,
    pressLatched,
    setKeepAliveInBackground,
    retryMicPermission,
    selfId,
  };
}
