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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';

import { AudioEngineProvider, useAudioEngine } from '../../../providers/rezonate/AudioEngineProvider';
import { renderPatternToWav } from '../../../lib/rezonate/AudioExporter';
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

// ── ExportController ──────────────────────────────────────────────────────────
//
// Inner component rendered inside <AudioEngineProvider> so it can call
// useAudioEngine() to access SampleStore buffers for WAV export.
// Renders only the Export WAV button.

interface ExportControllerProps {
  steps: boolean[][];
  bpm: number;
  project: ProjectData | null;
}

function ExportController({ steps, bpm, project }: ExportControllerProps) {
  const { samples } = useAudioEngine();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      // Build the ordered list of track IDs matching the patternSteps rows.
      const trackIds: string[] = (project?.tracks ?? []).map((t: { id: string }) => `track-${t.id}`);
      // Pull AudioBuffers from SampleStore via the public get() method.
      const trackBuffers = new Map<string, AudioBuffer>();
      trackIds.forEach((id) => {
        const buf = samples.get(id);
        if (buf) trackBuffers.set(id, buf);
      });
      const wav = await renderPatternToWav(steps, trackBuffers, trackIds, { bpm, bars: 4 });
      // Trigger browser download.
      const url = URL.createObjectURL(wav);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project?.name ?? 'beat'}.wav`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
    setIsExporting(false);
  }, [isExporting, project, steps, bpm, samples]);

  return (
    <button
      onClick={handleExport}
      disabled={isExporting}
      className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
    >
      {isExporting ? 'Exporting…' : 'Export WAV'}
    </button>
  );
}

// ── ClockSequencer ────────────────────────────────────────────────────────────
//
// Inner component rendered inside <AudioEngineProvider> so it can call
// useAudioEngine().  It owns the beat→step subscription and schedules sample
// playback via SampleStore whenever an active pattern step falls on a beat or
// subdivision.

interface ClockSequencerProps {
  isPlaying: boolean;
  bpm: number;
  /** The 2-D pattern grid: patternSteps[trackIndex][stepIndex] = active. */
  patternSteps: boolean[][];
  project: ProjectData | null;
  setCurrentStep: (step: number) => void;
}

function ClockSequencer({
  isPlaying,
  bpm,
  patternSteps,
  project,
  setCurrentStep,
}: ClockSequencerProps) {
  const { clock, samples } = useAudioEngine();

  /**
   * Tracks which 16-step position the sequencer is currently on.
   * Updated on every beat so the value is available synchronously inside the
   * scheduler callback without a stale-closure problem.
   */
  const step16Ref = useRef(0);

  /**
   * Best-effort sample presence check when the project loads.
   * Logs any tracks that are not yet in SampleStore so we know what still
   * needs to be fetched from Supabase Storage.
   * TODO: load from Supabase Storage when audio_file URLs are available.
   */
  useEffect(() => {
    if (!project) return;
    (project.tracks ?? []).forEach((track) => {
      if (!samples.has(`track-${track.id}`)) {
        console.debug(
          `[StudioPage] track-${track.id} not in SampleStore — needs loading`
        );
      }
    });
  }, [project, samples]);

  /**
   * Subscribe to BpmClock beat events while playback is active.
   *
   * Each BeatEvent covers one quarter-note beat (beatIndex 0-3).  Within that
   * beat we schedule all four 16th-note subdivisions using Web Audio time so
   * they fire at the exact sample-accurate moment rather than relying on JS
   * timers.
   */
  useEffect(() => {
    if (!isPlaying) return;

    const secondsPerBeat = 60 / bpm;

    const unsub = clock.onBeat((evt) => {
      const stepBase = evt.beatIndex * 4;

      for (let sub = 0; sub < 4; sub++) {
        const step = stepBase + sub;
        // Schedule each subdivision ahead of its exact Web Audio time.
        const fireAt = evt.barTime + sub * (secondsPerBeat / 4);

        patternSteps.forEach((trackSteps, trackIndex) => {
          if (trackSteps[step]) {
            const trackId = project?.tracks?.[trackIndex]?.id;
            if (trackId) {
              samples.play(`track-${trackId}`, fireAt);
            }
          }
        });
      }

      // Update 16-step position for PatternEditor highlight.
      step16Ref.current = stepBase;
      setCurrentStep(stepBase);
    });

    return unsub;
  }, [isPlaying, clock, samples, bpm, patternSteps, project, setCurrentStep]);

  // This component has no visual output — it only wires the audio scheduler.
  return null;
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

  // ── Publish state ──────────────────────────────────────────────────────────

  const [isPublished, setIsPublished] = useState(false);
  const [publishMsg, setPublishMsg] = useState('');

  const handlePublish = useCallback(async () => {
    if (!project?.id) return;
    const res = await fetch('/api/rezonate/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'publish', project_id: project.id, price_cents: 0, license_type: 'non_exclusive' }),
    });
    const json = await res.json();
    if (json.data) {
      setIsPublished(true);
      setPublishMsg(`Published → /rezonate/beat/${json.data.public_slug}`);
      setTimeout(() => setPublishMsg(''), 4000);
    }
  }, [project]);

  // ── Transport state ────────────────────────────────────────────────────────

  const [bpm, setBpm] = useState(120);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(-1);
  const [currentStep, setCurrentStep] = useState(-1);

  // Sync BPM from loaded project.
  useEffect(() => {
    if (project?.bpm) setBpm(project.bpm);
  }, [project]);

  // Beat counter driven by a simple interval while playing.
  // currentStep is now driven by the BpmClock subscription in ClockSequencer.
  useEffect(() => {
    if (!isPlaying) {
      setCurrentBeat(-1);
      setCurrentStep(-1);
      return;
    }
    let beat = 0;
    setCurrentBeat(0);
    setCurrentStep(0);
    const beatMs = (60 / bpm) * 1000;
    const beatId = setInterval(() => {
      beat = (beat + 1) % 4;
      setCurrentBeat(beat);
    }, beatMs);
    return () => {
      clearInterval(beatId);
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
        {/* Wire the BpmClock → SampleStore sequencer without adding any UI. */}
        <ClockSequencer
          isPlaying={isPlaying}
          bpm={bpm}
          patternSteps={steps}
          project={project}
          setCurrentStep={setCurrentStep}
        />
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

              {/* Export WAV + Publish button + feedback */}
              <div className="shrink-0 flex items-center gap-2 justify-end">
                <ExportController steps={steps} bpm={bpm} project={project} />
                <button
                  onClick={handlePublish}
                  disabled={isPublished}
                  className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-gray-700 text-white text-sm rounded-lg transition-colors"
                >
                  {isPublished ? 'Published ✓' : 'Publish'}
                </button>
              </div>
              {publishMsg && <span className="text-emerald-400 text-xs">{publishMsg}</span>}
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
