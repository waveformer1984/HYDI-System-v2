import React, { useState, useRef, useEffect, useCallback } from 'react';

interface BeatBoxCaptureProps {
  projectId?: string;
  onSave?: (session: CaptureSession) => Promise<void>;
}

interface CaptureSession {
  projectId?: string;
  pads: Array<{
    padIndex: number;
    label: string;
    audioBlob: Blob;
    durationMs: number;
    mimeType: string;
  }>;
  capturedAt: string;
}

type PadStatus = 'idle' | 'recording' | 'has-sample' | 'playing';

interface PadState {
  status: PadStatus;
  durationMs: number;
  elapsedMs: number;
  blob: Blob | null;
  mimeType: string;
}

const PAD_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;
const MAX_RECORD_MS = 8000;
const LONG_PRESS_MS = 500;
const SCHEDULER_INTERVAL_MS = 25;
const LOOKAHEAD_SEC = 0.1;
const BEATS_PER_BAR = 4;
const DEFAULT_BPM = 120;
const MIN_BPM = 60;
const MAX_BPM = 200;

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function MicIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-gray-400">
      <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2zm7 8a1 1 0 0 1 1 1 8 8 0 0 1-7 7.938V21h2a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2h2v-1.062A8 8 0 0 1 4 12a1 1 0 0 1 2 0 6 6 0 0 0 12 0 1 1 0 0 1 1-1z" />
    </svg>
  );
}

function WaveformIcon({ className = 'w-6 h-6 text-violet-300' }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M2 12a1 1 0 0 1 1-1h1a1 1 0 0 1 0 2H3a1 1 0 0 1-1-1zm4-4a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V8zm5-4a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1V4zm5 4a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1V8z" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin w-4 h-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

function buildInitialPads(): PadState[] {
  return PAD_LABELS.map(() => ({
    status: 'idle' as PadStatus,
    durationMs: 0,
    elapsedMs: 0,
    blob: null,
    mimeType: '',
  }));
}

export default function BeatBoxCapture({ projectId, onSave }: BeatBoxCaptureProps) {
  const [pads, setPads] = useState<PadState[]>(buildInitialPads);
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(-1);
  const [loopEnabled, setLoopEnabled] = useState<Set<number>>(new Set());
  const [toastError, setToastError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingPadRef = useRef<number | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef<number>(0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  // Audio engine
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioBuffersRef = useRef<Map<number, AudioBuffer>>(new Map());
  const audioUrlsRef = useRef<Map<number, string>>(new Map());
  const schedulerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nextBarTimeRef = useRef<number>(0);
  const bpmRef = useRef(DEFAULT_BPM);
  const loopEnabledRef = useRef<Set<number>>(new Set());
  const tapTimesRef = useRef<number[]>([]);

  // Keep hot refs in sync with state so scheduler closure always reads current values
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { loopEnabledRef.current = loopEnabled; }, [loopEnabled]);

  const showToast = useCallback((msg: string) => {
    setToastError(msg);
    setTimeout(() => setToastError(null), 4000);
  }, []);

  // ── AudioContext (lazy, user-gesture safe) ─────────────────────────────────

  const getAudioCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  // ── Global cleanup ─────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
      if (schedulerRef.current) clearInterval(schedulerRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      audioUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      audioCtxRef.current?.close();
    };
  }, []);

  // ── Beat indicator — driven by isPlaying + bpm ─────────────────────────────
  // Separate from the audio scheduler so BPM changes restart the visual tick
  // without touching the precise Web Audio clock.

  useEffect(() => {
    if (!isPlaying) {
      setCurrentBeat(-1);
      return;
    }
    let beat = 0;
    setCurrentBeat(0);
    const ms = (60 / bpm) * 1000;
    const id = setInterval(() => {
      beat = (beat + 1) % BEATS_PER_BAR;
      setCurrentBeat(beat);
    }, ms);
    return () => clearInterval(id);
  }, [isPlaying, bpm]);

  // ── Look-ahead scheduler ───────────────────────────────────────────────────
  // Fires every 25 ms and schedules AudioBufferSourceNodes up to 100 ms ahead.
  // Reads bpmRef and loopEnabledRef so it always uses the current values even
  // inside a stale closure.

  const scheduleLoop = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const secondsPerBeat = 60 / bpmRef.current;
    const secondsPerBar = secondsPerBeat * BEATS_PER_BAR;
    while (nextBarTimeRef.current < ctx.currentTime + LOOKAHEAD_SEC) {
      loopEnabledRef.current.forEach(padIndex => {
        const buf = audioBuffersRef.current.get(padIndex);
        if (!buf) return;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(Math.max(nextBarTimeRef.current, ctx.currentTime));
      });
      nextBarTimeRef.current += secondsPerBar;
    }
  }, []);

  const startPlayback = useCallback(() => {
    const ctx = getAudioCtx();
    nextBarTimeRef.current = ctx.currentTime + 0.05;
    if (schedulerRef.current) clearInterval(schedulerRef.current);
    schedulerRef.current = setInterval(scheduleLoop, SCHEDULER_INTERVAL_MS);
    setIsPlaying(true);
  }, [getAudioCtx, scheduleLoop]);

  const stopPlayback = useCallback(() => {
    if (schedulerRef.current) { clearInterval(schedulerRef.current); schedulerRef.current = null; }
    setIsPlaying(false);
  }, []);

  // ── Tap tempo ──────────────────────────────────────────────────────────────

  const handleTapTempo = useCallback(() => {
    const now = Date.now();
    const taps = tapTimesRef.current;
    if (taps.length > 0 && now - taps[taps.length - 1] > 3000) {
      taps.length = 0;
    }
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length >= 2) {
      const intervals = taps.slice(1).map((t, i) => t - taps[i]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const detected = Math.round(60000 / avg);
      setBpm(Math.max(MIN_BPM, Math.min(MAX_BPM, detected)));
    }
  }, []);

  // ── Recording helpers ──────────────────────────────────────────────────────

  const clearElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current !== null) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const clearAutoStop = useCallback(() => {
    if (autoStopTimerRef.current !== null) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
  }, []);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  const revokeUrl = useCallback((padIndex: number) => {
    const url = audioUrlsRef.current.get(padIndex);
    if (url) {
      URL.revokeObjectURL(url);
      audioUrlsRef.current.delete(padIndex);
    }
  }, []);

  const finishRecording = useCallback(
    async (padIndex: number, chunks: BlobPart[], mimeType: string) => {
      clearElapsedTimer();
      clearAutoStop();
      stopStream();

      const durationMs = Date.now() - recordingStartRef.current;
      const blob = new Blob(chunks, { type: mimeType });

      revokeUrl(padIndex);
      audioUrlsRef.current.set(padIndex, URL.createObjectURL(blob));

      setPads(prev =>
        prev.map((p, i) =>
          i === padIndex
            ? { ...p, status: 'has-sample', durationMs, elapsedMs: 0, blob, mimeType }
            : p
        )
      );

      recordingPadRef.current = null;
      mediaRecorderRef.current = null;
      chunksRef.current = [];

      // Decode to AudioBuffer so the scheduler and playPad can use the Web Audio clock
      try {
        const ctx = getAudioCtx();
        const arrayBuf = await blob.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(arrayBuf);
        audioBuffersRef.current.set(padIndex, audioBuf);
      } catch {
        // Non-fatal — URL fallback still works for one-shot taps
      }
    },
    [clearElapsedTimer, clearAutoStop, stopStream, revokeUrl, getAudioCtx]
  );

  const startRecording = useCallback(
    async (padIndex: number) => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        showToast('Microphone permission denied. Please allow mic access and try again.');
        return;
      }

      streamRef.current = stream;
      recordingPadRef.current = padIndex;
      chunksRef.current = [];
      recordingStartRef.current = Date.now();

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        finishRecording(padIndex, chunksRef.current, recorder.mimeType);
      };
      recorder.start(100);

      setPads(prev =>
        prev.map((p, i) =>
          i === padIndex ? { ...p, status: 'recording', elapsedMs: 0 } : p
        )
      );

      elapsedTimerRef.current = setInterval(() => {
        setPads(prev =>
          prev.map((p, i) =>
            i === padIndex ? { ...p, elapsedMs: Date.now() - recordingStartRef.current } : p
          )
        );
      }, 100);

      autoStopTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }, MAX_RECORD_MS);
    },
    [showToast, finishRecording]
  );

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // ── One-shot playback via AudioContext ─────────────────────────────────────
  // Multiple pads can play simultaneously (each gets its own source node).

  const playPad = useCallback((padIndex: number, pad: PadState) => {
    const ctx = getAudioCtx();
    const buf = audioBuffersRef.current.get(padIndex);

    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
      setPads(prev =>
        prev.map((p, i) => i === padIndex ? { ...p, status: 'playing' } : p)
      );
      src.onended = () => {
        setPads(prev =>
          prev.map((p, i) =>
            i === padIndex && p.status === 'playing' ? { ...p, status: 'has-sample' } : p
          )
        );
      };
      return;
    }

    // Fallback when AudioBuffer isn't decoded yet
    const url = audioUrlsRef.current.get(padIndex);
    if (!url) return;
    const audio = new Audio(url);
    setPads(prev => prev.map((p, i) => i === padIndex ? { ...p, status: 'playing' } : p));
    audio.onended = () => {
      setPads(prev =>
        prev.map((p, i) => i === padIndex ? { ...p, status: 'has-sample' } : p)
      );
    };
    audio.play().catch(() => {
      setPads(prev => prev.map((p, i) => i === padIndex ? { ...p, status: 'has-sample' } : p));
    });
  }, [getAudioCtx]);

  // ── Pad interactions ───────────────────────────────────────────────────────

  const isAnyRecording = pads.some(p => p.status === 'recording');

  const handlePadTap = useCallback((padIndex: number) => {
    const pad = pads[padIndex];
    if (pad.status === 'recording') { stopRecording(); return; }
    if (isAnyRecording) return;
    if (pad.status === 'idle') { startRecording(padIndex); return; }
    if (pad.status === 'has-sample' || pad.status === 'playing') {
      playPad(padIndex, pad);
    }
  }, [pads, isAnyRecording, stopRecording, startRecording, playPad]);

  const clearPad = useCallback((padIndex: number) => {
    revokeUrl(padIndex);
    audioBuffersRef.current.delete(padIndex);
    setLoopEnabled(prev => {
      const next = new Set(prev);
      next.delete(padIndex);
      return next;
    });
    setPads(prev =>
      prev.map((p, i) =>
        i === padIndex
          ? { status: 'idle', durationMs: 0, elapsedMs: 0, blob: null, mimeType: '' }
          : p
      )
    );
  }, [revokeUrl]);

  const handleLongPressStart = useCallback((padIndex: number) => {
    const pad = pads[padIndex];
    if (pad.status !== 'has-sample' && pad.status !== 'playing') return;
    longPressTimerRef.current = setTimeout(() => clearPad(padIndex), LONG_PRESS_MS);
  }, [pads, clearPad]);

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const toggleLoop = useCallback((e: React.MouseEvent | React.TouchEvent, padIndex: number) => {
    e.stopPropagation();
    setLoopEnabled(prev => {
      const next = new Set(prev);
      if (next.has(padIndex)) next.delete(padIndex);
      else next.add(padIndex);
      return next;
    });
  }, []);

  const handleClearAll = useCallback(() => {
    stopPlayback();
    audioUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    audioUrlsRef.current.clear();
    audioBuffersRef.current.clear();
    setLoopEnabled(new Set());
    setPads(buildInitialPads());
  }, [stopPlayback]);

  const handleSave = useCallback(async () => {
    if (!onSave) return;
    const filledPads = pads
      .map((p, i) => ({ ...p, padIndex: i }))
      .filter(p => p.blob !== null && (p.status === 'has-sample' || p.status === 'playing'));
    if (filledPads.length === 0) return;

    const session: CaptureSession = {
      projectId,
      pads: filledPads.map(p => ({
        padIndex: p.padIndex,
        label: PAD_LABELS[p.padIndex],
        audioBlob: p.blob as Blob,
        durationMs: p.durationMs,
        mimeType: p.mimeType,
      })),
      capturedAt: new Date().toISOString(),
    };

    setIsSaving(true);
    try {
      await onSave(session);
    } finally {
      setIsSaving(false);
    }
  }, [pads, onSave, projectId]);

  const hasSamples = pads.some(
    p => p.blob !== null && (p.status === 'has-sample' || p.status === 'playing')
  );

  // ── Styles ─────────────────────────────────────────────────────────────────

  function padClasses(pad: PadState, isLooped: boolean): string {
    const base =
      'relative flex flex-col items-center justify-center min-h-[80px] rounded-xl cursor-pointer select-none transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-violet-400';
    const loopRing = isLooped && pad.status !== 'recording' ? 'ring-2 ring-violet-400' : '';
    switch (pad.status) {
      case 'idle':       return `${base} bg-gray-800 text-gray-400 hover:bg-gray-700`;
      case 'recording':  return `${base} bg-gray-800 text-red-400 ring-4 ring-red-500 animate-pulse`;
      case 'has-sample': return `${base} bg-violet-900 border border-violet-500 text-violet-200 ${loopRing}`;
      case 'playing':    return `${base} bg-emerald-700 text-white ${loopRing}`;
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="bg-gray-900 min-h-screen p-4 flex flex-col gap-4">

      {toastError && (
        <div className="w-full bg-red-800 text-red-100 text-sm px-4 py-3 rounded-lg text-center">
          {toastError}
        </div>
      )}

      {/* Transport + BPM */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setBpm(b => Math.max(MIN_BPM, b - 1))}
          className="w-8 h-8 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-bold flex items-center justify-center text-lg leading-none"
          aria-label="Decrease BPM"
        >−</button>

        <div className="flex-1 text-center">
          <span className="text-white font-mono font-bold text-sm">{bpm}</span>
          <span className="text-gray-400 text-xs ml-1">BPM</span>
        </div>

        <button
          onClick={() => setBpm(b => Math.min(MAX_BPM, b + 1))}
          className="w-8 h-8 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-bold flex items-center justify-center text-lg leading-none"
          aria-label="Increase BPM"
        >+</button>

        <button
          onClick={handleTapTempo}
          className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-white text-xs font-medium"
        >
          TAP
        </button>

        <button
          onClick={isPlaying ? stopPlayback : startPlayback}
          className={`px-4 py-1.5 rounded-lg text-white text-xs font-bold transition-colors ${
            isPlaying
              ? 'bg-red-600 hover:bg-red-500'
              : 'bg-emerald-600 hover:bg-emerald-500'
          }`}
        >
          {isPlaying ? '■ STOP' : '▶ PLAY'}
        </button>
      </div>

      {/* Beat indicator */}
      <div className="flex justify-center gap-3">
        {Array.from({ length: BEATS_PER_BAR }).map((_, i) => (
          <div
            key={i}
            className={`w-2.5 h-2.5 rounded-full transition-all duration-75 ${
              currentBeat === i
                ? i === 0
                  ? 'bg-violet-400 scale-150'
                  : 'bg-violet-300 scale-125'
                : 'bg-gray-700'
            }`}
          />
        ))}
      </div>

      {/* Pad grid */}
      <div className="grid grid-cols-4 gap-3">
        {pads.map((pad, i) => {
          const isDisabled = isAnyRecording && pad.status !== 'recording';
          const progressPct = pad.status === 'recording'
            ? Math.min((pad.elapsedMs / MAX_RECORD_MS) * 100, 100)
            : 0;
          const isLooped = loopEnabled.has(i);

          return (
            <button
              key={i}
              className={`${padClasses(pad, isLooped)} ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              disabled={isDisabled}
              onClick={() => handlePadTap(i)}
              onMouseDown={() => handleLongPressStart(i)}
              onMouseUp={handleLongPressEnd}
              onMouseLeave={handleLongPressEnd}
              onTouchStart={(e) => { e.preventDefault(); handleLongPressStart(i); }}
              onTouchEnd={handleLongPressEnd}
              onTouchCancel={handleLongPressEnd}
              aria-label={`Pad ${PAD_LABELS[i]}${pad.status === 'has-sample' ? ' — has recording' : ''}`}
            >
              {/* Recording progress bar */}
              {pad.status === 'recording' && (
                <div
                  className="absolute top-0 left-0 h-1 rounded-t-xl bg-red-500 transition-all duration-100"
                  style={{ width: `${progressPct}%` }}
                />
              )}

              {/* Loop toggle */}
              {(pad.status === 'has-sample' || pad.status === 'playing') && (
                <button
                  className={`absolute top-1 right-1 w-5 h-5 rounded-full text-xs flex items-center justify-center transition-colors ${
                    isLooped
                      ? 'bg-violet-500 text-white'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                  onClick={(e) => toggleLoop(e, i)}
                  onTouchEnd={(e) => toggleLoop(e, i)}
                  aria-label={`${isLooped ? 'Disable' : 'Enable'} loop for pad ${PAD_LABELS[i]}`}
                >
                  ↻
                </button>
              )}

              <span className="text-xs font-bold mb-1 opacity-70">{PAD_LABELS[i]}</span>

              {pad.status === 'idle' && <MicIcon />}
              {pad.status === 'recording' && (
                <div className="w-4 h-4 rounded-full bg-red-500" />
              )}
              {(pad.status === 'has-sample' || pad.status === 'playing') && (
                <WaveformIcon
                  className={`w-6 h-6 ${pad.status === 'playing' ? 'text-emerald-200' : 'text-violet-300'}`}
                />
              )}

              {pad.status === 'has-sample' && (
                <span className="text-xs mt-1 text-violet-300">{formatDuration(pad.durationMs)}</span>
              )}
              {pad.status === 'recording' && (
                <span className="text-xs mt-1 text-red-300">{formatDuration(pad.elapsedMs)}</span>
              )}
              {pad.status === 'playing' && (
                <span className="text-xs mt-1 text-emerald-200">{formatDuration(pad.durationMs)}</span>
              )}
            </button>
          );
        })}
      </div>

      <p className="text-center text-xs text-gray-500">
        Tap to record · tap again to stop · long-press to clear · ↻ loops on PLAY
      </p>

      <div className="flex gap-3 mt-2">
        <button
          onClick={handleClearAll}
          className="flex-1 py-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium transition-colors"
        >
          Clear All
        </button>
        <button
          onClick={handleSave}
          disabled={!hasSamples || isSaving || !onSave}
          className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isSaving && <SpinnerIcon />}
          {isSaving ? 'Saving…' : 'Save Session'}
        </button>
      </div>
    </div>
  );
}
