/**
 * AudioEngineProvider
 *
 * React context provider that owns the shared audio engine instances for all
 * Rezonate UI components. Instances are created once on mount and torn down on
 * unmount. Consumer components import `useAudioEngine` instead of instantiating
 * their own AudioContext or scheduler.
 *
 * Usage:
 *   Wrap the subtree that contains Rezonate components with <AudioEngineProvider>.
 *   Any component inside the tree can then call useAudioEngine() to get the
 *   shared context value.
 *
 * NOTE: The lib modules imported below may not exist on disk yet. They are
 * declared here as forward references per the design specification.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

// Forward-declared lib imports — modules may not yet exist on disk.
import { AudioEngine } from '../../lib/rezonate/AudioEngine';
import { BpmClock } from '../../lib/rezonate/BpmClock';
import { SampleStore } from '../../lib/rezonate/SampleStore';
import { MidiController } from '../../lib/rezonate/MidiController';
import { IndexedDBCache } from '../../lib/rezonate/IndexedDBCache';

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_BPM = 120;

// ── Context shape ─────────────────────────────────────────────────────────────

export interface AudioEngineContextValue {
  /** Shared AudioEngine singleton. */
  engine: AudioEngine;
  /** BPM-aware beat clock. */
  clock: BpmClock;
  /** Sample registry — load and play named blobs. */
  samples: SampleStore;
  /** MIDI controller for external device input. */
  midi: MidiController;
  /** IndexedDB-backed blob cache for persisting pad recordings. */
  cache: IndexedDBCache;
  /** Current BPM value (read from state). */
  bpm: number;
  /** Update the BPM; writes to both clock.bpm and React state. */
  setBpm: (bpm: number) => void;
  /** Whether the clock is currently running. */
  isPlaying: boolean;
  /** Start the clock (calls clock.start()). */
  startPlayback: () => void;
  /** Stop the clock (calls clock.stop()). */
  stopPlayback: () => void;
  /**
   * Beat position within the current bar.
   * -1 when stopped, 0–3 when playing (BEATS_PER_BAR = 4).
   */
  currentBeat: number;
}

// ── Context ───────────────────────────────────────────────────────────────────

export const AudioEngineContext =
  createContext<AudioEngineContextValue | null>(null);

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns the shared AudioEngineContextValue.
 * Throws if called outside of <AudioEngineProvider>.
 */
export function useAudioEngine(): AudioEngineContextValue {
  const ctx = useContext(AudioEngineContext);
  if (ctx === null) {
    throw new Error(
      'useAudioEngine must be called within an <AudioEngineProvider>. ' +
        'Wrap the component tree that contains Rezonate components with <AudioEngineProvider>.'
    );
  }
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

interface AudioEngineProviderProps {
  children: React.ReactNode;
}

/**
 * AudioEngineProvider
 *
 * Creates and owns the shared audio engine instances. Mount this once at or
 * near the root of the Rezonate feature tree. All Rezonate UI components
 * should consume context via useAudioEngine() rather than creating their own
 * AudioContext or scheduler.
 */
export function AudioEngineProvider({ children }: AudioEngineProviderProps) {
  const [bpm, setBpmState] = useState(DEFAULT_BPM);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(-1);

  // Hold engine instances in refs so they survive renders without triggering
  // re-renders themselves. The instances are created once on mount.
  const engineRef = useRef<AudioEngine | null>(null);
  const clockRef = useRef<BpmClock | null>(null);
  const samplesRef = useRef<SampleStore | null>(null);
  const midiRef = useRef<MidiController | null>(null);
  const cacheRef = useRef<IndexedDBCache | null>(null);

  // ── Mount: create instances, open DB, attempt MIDI ───────────────────────

  useEffect(() => {
    const engine = AudioEngine.getInstance();
    const clock = new BpmClock(engine);
    const samples = new SampleStore(engine);
    const midi = new MidiController();
    const cache = new IndexedDBCache();

    engineRef.current = engine;
    clockRef.current = clock;
    samplesRef.current = samples;
    midiRef.current = midi;
    cacheRef.current = cache;

    // Set initial BPM on the clock in case it differs from the default.
    clock.bpm = DEFAULT_BPM;

    // Open IndexedDB — non-blocking; failures are tolerated.
    cache.open().catch(() => {
      // Non-fatal: pads will still work without persistence.
    });

    // Attempt MIDI connect — silent failure is fine on platforms where the
    // Web MIDI API is unavailable or the user denies permission.
    midi.connect().catch(() => {
      // Non-fatal.
    });

    // Subscribe to beat events from the clock to drive currentBeat state.
    const unsubBeat = clock.onBeat((evt) => {
      setCurrentBeat(evt.beatIndex);
    });

    // ── Cleanup on unmount ──────────────────────────────────────────────────
    return () => {
      unsubBeat();
      clock.stop();
      midi.disconnect();
      engine.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentionally once

  // ── setBpm — writes to clock and React state ──────────────────────────────

  const setBpm = useCallback((newBpm: number) => {
    if (clockRef.current) {
      clockRef.current.bpm = newBpm;
    }
    setBpmState(newBpm);
  }, []);

  // ── startPlayback / stopPlayback ──────────────────────────────────────────

  const startPlayback = useCallback(() => {
    if (!clockRef.current) return;
    clockRef.current.start();
    setIsPlaying(true);
    setCurrentBeat(0);
  }, []);

  const stopPlayback = useCallback(() => {
    if (!clockRef.current) return;
    clockRef.current.stop();
    setIsPlaying(false);
    setCurrentBeat(-1);
  }, []);

  // ── Build context value ───────────────────────────────────────────────────
  // We gate rendering until all instances have been created to avoid exposing
  // null refs to consumers. In practice the useEffect runs synchronously
  // before the first paint in React 18 strict mode (double-invocation aside),
  // so this branch is only hit during the very first render frame.

  if (
    !engineRef.current ||
    !clockRef.current ||
    !samplesRef.current ||
    !midiRef.current ||
    !cacheRef.current
  ) {
    // Render children without context during the brief initialization window
    // so the UI is not blocked. The context value will be populated before
    // any child component can meaningfully interact with it (user gesture
    // required for AudioContext to operate).
    return <>{children}</>;
  }

  const contextValue: AudioEngineContextValue = {
    engine: engineRef.current,
    clock: clockRef.current,
    samples: samplesRef.current,
    midi: midiRef.current,
    cache: cacheRef.current,
    bpm,
    setBpm,
    isPlaying,
    startPlayback,
    stopPlayback,
    currentBeat,
  };

  return (
    <AudioEngineContext.Provider value={contextValue}>
      {children}
    </AudioEngineContext.Provider>
  );
}
