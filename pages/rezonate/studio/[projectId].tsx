/**
 * pages/rezonate/studio/[projectId].tsx
 *
 * Dynamic studio page — /rezonate/studio/<projectId>
 *
 * Architecture:
 *   - Dynamic Next.js route via pages router.
 *   - All studio components are loaded with `dynamic(..., { ssr: false })` so
 *     canvas, AudioContext, and range inputs are only instantiated in the browser.
 *   - Project data is fetched from /api/rezonate/route.js with action 'get_project'.
 *   - The entire studio UI is wrapped in AudioEngineProvider.
 *
 * Layout (desktop):
 *   ┌─────────────────────────────────────────────────────┐
 *   │ TopBar: ← link | TransportBar + BeatIndicator | name│
 *   ├──────────┬──────────────────────────┬───────────────┤
 *   │ TrackList│ WaveformDisplay          │ MixerConsole  │
 *   │ (sidebar)│ + PatternEditor          │ (right panel) │
 *   └──────────┴──────────────────────────┴───────────────┘
 *
 * Mobile: single-column stack (lg:grid kicks in at ≥1024px).
 */

import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';

import { AudioEngineProvider } from '../../../providers/rezonate/AudioEngineProvider';
import type { Track } from '../../../components/rezonate/studio/TrackList';
import type { MixerChannel } from '../../../components/rezonate/studio/MixerConsole';

// ── Dynamic imports (browser-only) ────────────────────────────────────────────

const TransportBar = dynamic(
  () => import('../../../components/rezonate/transport/TransportBar'),
  { ssr: false }
);

const BeatIndicator = dynamic(
  () => import('../../../components/rezonate/transport/BeatIndicator'),
  { ssr: false }
);

const TrackList = dynamic(
  () => import('../../../components/rezonate/studio/TrackList'),
  { ssr: false }
);

const WaveformDisplay = dynamic(
  () => import('../../../components/rezonate/studio/WaveformDisplay'),
  { ssr: false }
);

const PatternEditor = dynamic(
  () => import('../../../components/rezonate/studio/PatternEditor'),
  { ssr: false }
);

const MixerConsole = dynamic(
  () => import('../../../components/rezonate/studio/MixerConsole'),
  { ssr: false }
);

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProjectData {
  id: string;
  name: string;
  bpm: number;
  tracks: Track[];
}

// ── Default / seed data helpers ───────────────────────────────────────────────

const DEFAULT_TRACK_LABELS = ['Kick', 'Snare', 'Hi-Hat', 'Perc'];
const TOTAL_STEPS = 16;

function buildDefaultSteps(numTracks: number): boolean[][] {
  return Array.from({ length: numTracks }, () =>
    Array.from({ length: TOTAL_STEPS }, () => false)
  );
}

function buildMixerChannels(tracks: Track[]): MixerChannel[] {
  const TRACK_COLORS: Record<Track['type'], string> = {
    audio:      '#8b5cf6', // violet-500
    midi:       '#10b981', // emerald-500
    instrument: '#0ea5e9', // sky-500
  };

  return tracks.map((t) => ({
    id: t.id,
    label: t.name,
    volume: t.volume,
    pan: t.pan,
    muted: t.muted,
    color: TRACK_COLORS[t.type],
  }));
}

// ── Page component ────────────────────────────────────────────────────────────

export default function StudioPage() {
  const router = useRouter();
  const { projectId } = router.query;
  const resolvedProjectId =
    typeof projectId === 'string' ? projectId : undefined;

  // ── Data loading ───────────────────────────────────────────────────────────

  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!resolvedProjectId) return;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    fetch('/api/rezonate/route.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_project', projectId: resolvedProjectId }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json();
      })
      .then((data: ProjectData) => {
        if (!cancelled) setProject(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [resolvedProjectId]);

  // ── Transport state ────────────────────────────────────────────────────────

  const [bpm, setBpm] = useState(120);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(-1);
  const [currentStep, setCurrentStep] = useState(-1);

  // Sync BPM from loaded project.
  useEffect(() => {
    if (project?.bpm) setBpm(project.bpm);
  }, [project]);

  // Beat/step counter driven by a simple interval while playing.
  useEffect(() => {
    if (!isPlaying) {
      setCurrentBeat(-1);
      setCurrentStep(-1);
      return;
    }
    let beat = 0;
    let step = 0;
    setCurrentBeat(0);
    setCurrentStep(0);
    const beatMs = (60 / bpm) * 1000;
    const stepMs = beatMs / 4; // 16th-note steps (4 per beat)
    const beatId = setInterval(() => {
      beat = (beat + 1) % 4;
      setCurrentBeat(beat);
    }, beatMs);
    const stepId = setInterval(() => {
      step = (step + 1) % TOTAL_STEPS;
      setCurrentStep(step);
    }, stepMs);
    return () => {
      clearInterval(beatId);
      clearInterval(stepId);
    };
  }, [isPlaying, bpm]);

  // Tap tempo — simple running average.
  const tapTimesRef = React.useRef<number[]>([]);
  const handleTap = useCallback(() => {
    const now = Date.now();
    const taps = tapTimesRef.current;
    if (taps.length > 0 && now - taps[taps.length - 1] > 3000) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length >= 2) {
      const intervals = taps.slice(1).map((t, i) => t - taps[i]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const detected = Math.round(60000 / avg);
      setBpm(Math.max(60, Math.min(200, detected)));
    }
  }, []);

  // ── Track state ────────────────────────────────────────────────────────────

  const [tracks, setTracks] = useState<Track[]>([]);

  // Populate tracks once project loads; fall back to empty array.
  useEffect(() => {
    if (project) setTracks(project.tracks ?? []);
  }, [project]);

  const handleMute = useCallback((id: string, muted: boolean) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, muted } : t)));
  }, []);

  const handleSolo = useCallback((id: string, solo: boolean) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, solo } : t)));
  }, []);

  const handleVolumeChange = useCallback((id: string, volume: number) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, volume } : t)));
  }, []);

  const handlePanChange = useCallback((id: string, pan: number) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, pan } : t)));
  }, []);

  const handleAddTrack = useCallback(() => {
    setTracks((prev) => [
      ...prev,
      {
        id: `track-${Date.now()}`,
        name: `Track ${prev.length + 1}`,
        type: 'audio',
        muted: false,
        solo: false,
        volume: 80,
        pan: 0,
      },
    ]);
  }, []);

  // ── Pattern state ──────────────────────────────────────────────────────────

  const trackLabels = tracks.length > 0
    ? tracks.map((t) => t.name)
    : DEFAULT_TRACK_LABELS;

  const [steps, setSteps] = useState<boolean[][]>(() =>
    buildDefaultSteps(DEFAULT_TRACK_LABELS.length)
  );

  // Resize steps array when track count changes.
  useEffect(() => {
    setSteps((prev) => {
      const count = trackLabels.length;
      if (prev.length === count) return prev;
      if (prev.length < count) {
        return [
          ...prev,
          ...Array.from({ length: count - prev.length }, () =>
            Array.from({ length: TOTAL_STEPS }, () => false)
          ),
        ];
      }
      return prev.slice(0, count);
    });
  }, [trackLabels.length]);

  const handleToggleStep = useCallback(
    (trackIdx: number, stepIdx: number) => {
      setSteps((prev) => {
        const next = prev.map((row) => [...row]);
        next[trackIdx][stepIdx] = !next[trackIdx][stepIdx];
        return next;
      });
    },
    []
  );

  // ── Mixer state ────────────────────────────────────────────────────────────

  const [mixerChannels, setMixerChannels] = useState<MixerChannel[]>([]);
  const [masterVolume, setMasterVolume] = useState(85);

  // Derive mixer channels from tracks.
  useEffect(() => {
    setMixerChannels(buildMixerChannels(tracks));
  }, [tracks]);

  const handleChannelChange = useCallback(
    (id: string, updates: Partial<MixerChannel>) => {
      setMixerChannels((prev) =>
        prev.map((ch) => (ch.id === id ? { ...ch, ...updates } : ch))
      );
      // Keep tracks and mixer in sync for volume/mute/pan.
      if ('volume' in updates && updates.volume !== undefined)
        handleVolumeChange(id, updates.volume);
      if ('muted' in updates && updates.muted !== undefined)
        handleMute(id, updates.muted);
      if ('pan' in updates && updates.pan !== undefined)
        handlePanChange(id, updates.pan);
    },
    [handleMute, handlePanChange, handleVolumeChange]
  );

  // ── Render helpers ─────────────────────────────────────────────────────────

  const projectName = project?.name ?? (loading ? '' : `Project ${resolvedProjectId ?? ''}`);

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-gray-400">
          <svg
            className="animate-spin w-8 h-8 text-violet-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
            />
          </svg>
          <span className="text-sm">Loading project…</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center px-6">
          <p className="text-red-400 text-sm">Failed to load project: {loadError}</p>
          <Link
            href="/rezonate"
            className="text-sm text-violet-400 hover:text-violet-300 underline transition-colors"
          >
            ← Back to Rezonate
          </Link>
        </div>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <>
      <Head>
        <title>{projectName ? `${projectName} — Studio` : 'Studio'} — Rezonate</title>
      </Head>

      <AudioEngineProvider>
        <div className="min-h-screen bg-gray-900 text-white flex flex-col">

          {/* ── Top bar ──────────────────────────────────────────────────── */}
          <header className="flex flex-col gap-2 px-4 py-3 border-b border-gray-800 bg-gray-900 z-10">
            {/* Row 1: back link + project name */}
            <div className="flex items-center justify-between gap-4">
              <Link
                href="/rezonate"
                className="text-sm text-gray-400 hover:text-white transition-colors shrink-0"
              >
                ← Rezonate
              </Link>

              <h1 className="text-base font-semibold tracking-wide text-white truncate text-center flex-1">
                {projectName}
              </h1>

              {/* Spacer keeps title visually centred */}
              <div className="w-20 shrink-0" />
            </div>

            {/* Row 2: transport controls */}
            <div className="flex flex-col gap-2">
              <TransportBar
                bpm={bpm}
                onBpmChange={setBpm}
                onTap={handleTap}
                isPlaying={isPlaying}
                onPlay={() => setIsPlaying(true)}
                onStop={() => setIsPlaying(false)}
              />
              <BeatIndicator currentBeat={currentBeat} />
            </div>
          </header>

          {/* ── Main content area ─────────────────────────────────────── */}
          <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">

            {/* Left sidebar — TrackList */}
            <aside className="lg:w-72 xl:w-80 shrink-0 border-b border-gray-800 lg:border-b-0 lg:border-r lg:border-gray-800 overflow-y-auto p-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
                Tracks
              </h2>
              <TrackList
                tracks={tracks}
                onMute={handleMute}
                onSolo={handleSolo}
                onVolumeChange={handleVolumeChange}
                onPanChange={handlePanChange}
                onAddTrack={handleAddTrack}
              />
            </aside>

            {/* Centre — Waveform + Pattern editor */}
            <section className="flex-1 flex flex-col gap-4 p-4 overflow-y-auto min-w-0">
              {/* Waveform display */}
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">
                  Waveform
                </h2>
                <div className="bg-gray-800 rounded-xl p-3">
                  <WaveformDisplay
                    audioBuffer={null}
                    height={64}
                    color="#8b5cf6"
                  />
                </div>
              </div>

              {/* Pattern editor */}
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">
                  Pattern
                </h2>
                <div className="bg-gray-800 rounded-xl p-3 overflow-x-auto">
                  <PatternEditor
                    steps={steps}
                    trackLabels={trackLabels}
                    onToggle={handleToggleStep}
                    currentStep={isPlaying ? currentStep : -1}
                  />
                </div>
              </div>
            </section>

            {/* Right panel — MixerConsole */}
            <aside className="lg:w-auto shrink-0 border-t border-gray-800 lg:border-t-0 lg:border-l lg:border-gray-800 overflow-x-auto p-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
                Mixer
              </h2>
              <MixerConsole
                channels={mixerChannels}
                masterVolume={masterVolume}
                onChannelChange={handleChannelChange}
                onMasterVolumeChange={setMasterVolume}
              />
            </aside>
          </main>
        </div>
      </AudioEngineProvider>
    </>
  );
}
