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

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function MicIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="w-6 h-6 text-gray-400"
    >
      <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2zm7 8a1 1 0 0 1 1 1 8 8 0 0 1-7 7.938V21h2a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2h2v-1.062A8 8 0 0 1 4 12a1 1 0 0 1 2 0 6 6 0 0 0 12 0 1 1 0 0 1 1-1z" />
    </svg>
  );
}

function WaveformIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="w-6 h-6 text-violet-300"
    >
      <path d="M2 12a1 1 0 0 1 1-1h1a1 1 0 0 1 0 2H3a1 1 0 0 1-1-1zm4-4a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V8zm5-4a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1V4zm5 4a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1V8z" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="animate-spin w-4 h-4 text-white"
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
  );
}

function buildInitialPads(): PadState[] {
  return PAD_LABELS.map(() => ({
    status: 'idle',
    durationMs: 0,
    elapsedMs: 0,
    blob: null,
    mimeType: '',
  }));
}

export default function BeatBoxCapture({ projectId, onSave }: BeatBoxCaptureProps) {
  const [pads, setPads] = useState<PadState[]>(buildInitialPads);
  const [toastError, setToastError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioUrlsRef = useRef<Map<number, string>>(new Map());
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const recordingPadRef = useRef<number | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef<number>(0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const showToast = useCallback((msg: string) => {
    setToastError(msg);
    setTimeout(() => setToastError(null), 4000);
  }, []);

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
      streamRef.current.getTracks().forEach((t) => t.stop());
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

  useEffect(() => {
    audioElRef.current = new Audio();
    return () => {
      clearElapsedTimer();
      clearAutoStop();
      stopStream();
      audioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      audioUrlsRef.current.clear();
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current = null;
      }
    };
  }, [clearElapsedTimer, clearAutoStop, stopStream]);

  const finishRecording = useCallback(
    (padIndex: number, chunks: BlobPart[], mimeType: string) => {
      clearElapsedTimer();
      clearAutoStop();
      stopStream();

      const durationMs = Date.now() - recordingStartRef.current;
      const blob = new Blob(chunks, { type: mimeType });

      revokeUrl(padIndex);
      const url = URL.createObjectURL(blob);
      audioUrlsRef.current.set(padIndex, url);

      setPads((prev) =>
        prev.map((p, i) =>
          i === padIndex
            ? { ...p, status: 'has-sample', durationMs, elapsedMs: 0, blob, mimeType }
            : p
        )
      );

      recordingPadRef.current = null;
      mediaRecorderRef.current = null;
      chunksRef.current = [];
    },
    [clearElapsedTimer, clearAutoStop, stopStream, revokeUrl]
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

      setPads((prev) =>
        prev.map((p, i) =>
          i === padIndex ? { ...p, status: 'recording', elapsedMs: 0 } : p
        )
      );

      elapsedTimerRef.current = setInterval(() => {
        setPads((prev) =>
          prev.map((p, i) =>
            i === padIndex ? { ...p, elapsedMs: Date.now() - recordingStartRef.current } : p
          )
        );
      }, 100);

      autoStopTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }, MAX_RECORD_MS);
    },
    [showToast, finishRecording]
  );

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const playPad = useCallback(
    (padIndex: number, blob: Blob) => {
      if (!audioElRef.current) return;

      const url = audioUrlsRef.current.get(padIndex);
      if (!url) return;

      audioElRef.current.pause();
      audioElRef.current.src = url;

      setPads((prev) =>
        prev.map((p, i) => (i === padIndex ? { ...p, status: 'playing' } : p))
      );

      audioElRef.current.onended = () => {
        setPads((prev) =>
          prev.map((p, i) => (i === padIndex ? { ...p, status: 'has-sample' } : p))
        );
      };

      audioElRef.current.play().catch(() => {
        setPads((prev) =>
          prev.map((p, i) => (i === padIndex ? { ...p, status: 'has-sample' } : p))
        );
      });
    },
    []
  );

  const isAnyRecording = pads.some((p) => p.status === 'recording');

  const handlePadTap = useCallback(
    (padIndex: number) => {
      const pad = pads[padIndex];

      if (pad.status === 'recording') {
        stopRecording();
        return;
      }

      if (isAnyRecording) return;

      if (pad.status === 'idle') {
        startRecording(padIndex);
        return;
      }

      if (pad.status === 'has-sample' && pad.blob) {
        playPad(padIndex, pad.blob);
        return;
      }

      if (pad.status === 'playing') {
        if (audioElRef.current) {
          audioElRef.current.pause();
          audioElRef.current.currentTime = 0;
        }
        setPads((prev) =>
          prev.map((p, i) => (i === padIndex ? { ...p, status: 'has-sample' } : p))
        );
      }
    },
    [pads, isAnyRecording, stopRecording, startRecording, playPad]
  );

  const clearPad = useCallback(
    (padIndex: number) => {
      revokeUrl(padIndex);
      setPads((prev) =>
        prev.map((p, i) =>
          i === padIndex
            ? { status: 'idle', durationMs: 0, elapsedMs: 0, blob: null, mimeType: '' }
            : p
        )
      );
    },
    [revokeUrl]
  );

  const handleLongPressStart = useCallback(
    (padIndex: number) => {
      const pad = pads[padIndex];
      if (pad.status !== 'has-sample' && pad.status !== 'playing') return;
      longPressTimerRef.current = setTimeout(() => {
        clearPad(padIndex);
      }, LONG_PRESS_MS);
    },
    [pads, clearPad]
  );

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleClearAll = useCallback(() => {
    if (audioElRef.current) {
      audioElRef.current.pause();
    }
    audioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    audioUrlsRef.current.clear();
    setPads(buildInitialPads());
  }, []);

  const handleSave = useCallback(async () => {
    if (!onSave) return;

    const filledPads = pads
      .map((p, i) => ({ ...p, padIndex: i }))
      .filter((p) => p.blob !== null && (p.status === 'has-sample' || p.status === 'playing'));

    if (filledPads.length === 0) return;

    const session: CaptureSession = {
      projectId,
      pads: filledPads.map((p) => ({
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
    (p) => p.blob !== null && (p.status === 'has-sample' || p.status === 'playing')
  );

  function padClasses(pad: PadState): string {
    const base =
      'relative flex flex-col items-center justify-center min-h-[80px] rounded-xl cursor-pointer select-none transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-violet-400';

    switch (pad.status) {
      case 'idle':
        return `${base} bg-gray-800 text-gray-400 hover:bg-gray-700`;
      case 'recording':
        return `${base} bg-gray-800 text-red-400 ring-4 ring-red-500 animate-pulse`;
      case 'has-sample':
        return `${base} bg-violet-900 border border-violet-500 text-violet-200`;
      case 'playing':
        return `${base} bg-emerald-700 text-white`;
    }
  }

  return (
    <div className="bg-gray-900 min-h-screen p-4 flex flex-col gap-4">
      {toastError && (
        <div className="w-full bg-red-800 text-red-100 text-sm px-4 py-3 rounded-lg text-center">
          {toastError}
        </div>
      )}

      <div className="grid grid-cols-4 gap-3">
        {pads.map((pad, i) => {
          const isDisabled = isAnyRecording && pad.status !== 'recording';
          const progressPct =
            pad.status === 'recording'
              ? Math.min((pad.elapsedMs / MAX_RECORD_MS) * 100, 100)
              : 0;

          return (
            <button
              key={i}
              className={`${padClasses(pad)} ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              disabled={isDisabled}
              onClick={() => handlePadTap(i)}
              onMouseDown={() => handleLongPressStart(i)}
              onMouseUp={handleLongPressEnd}
              onMouseLeave={handleLongPressEnd}
              onTouchStart={() => handleLongPressStart(i)}
              onTouchEnd={handleLongPressEnd}
              onTouchCancel={handleLongPressEnd}
              aria-label={`Pad ${PAD_LABELS[i]}${pad.status === 'has-sample' ? ' — has recording' : ''}`}
            >
              {pad.status === 'recording' && (
                <div
                  className="absolute top-0 left-0 h-1 rounded-t-xl bg-red-500 transition-all duration-100"
                  style={{ width: `${progressPct}%` }}
                />
              )}

              <span className="text-xs font-bold mb-1 text-current opacity-70">
                {PAD_LABELS[i]}
              </span>

              {pad.status === 'idle' && <MicIcon />}
              {pad.status === 'recording' && (
                <div className="w-4 h-4 rounded-full bg-red-500" />
              )}
              {(pad.status === 'has-sample' || pad.status === 'playing') && (
                <WaveformIcon />
              )}

              {pad.status === 'has-sample' && (
                <span className="text-xs mt-1 text-violet-300">
                  {formatDuration(pad.durationMs)}
                </span>
              )}
              {pad.status === 'recording' && (
                <span className="text-xs mt-1 text-red-300">
                  {formatDuration(pad.elapsedMs)}
                </span>
              )}
              {pad.status === 'playing' && (
                <span className="text-xs mt-1 text-emerald-200">
                  {formatDuration(pad.durationMs)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="text-center text-xs text-gray-500">
        Long-press a recorded pad to clear it
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
