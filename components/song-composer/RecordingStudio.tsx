import React, { useState, useRef, useCallback, useEffect } from 'react';

interface Layer {
  id: string;
  name: string;
  color: string;
  start_bar: number;
  duration_bars: number;
  muted: boolean;
  blob?: Blob;
  url?: string;
  duration_sec: number;
}

interface Props {
  bpm: number;
  totalBars: number;
  currentBar: number;
  onLayersChange: (layers: Layer[]) => void;
  onAnalyserReady: (analyser: AnalyserNode | null) => void;
  onRecordingChange: (recording: boolean) => void;
}

const LAYER_COLORS = ['#6366f1', '#ec4899', '#22c55e', '#f97316', '#14b8a6', '#eab308', '#8b5cf6', '#f43f5e'];
const LAYER_NAMES = ['Guitar', 'Bass', 'Vocals', 'Keys', 'Synth', 'Sample', 'Drums', 'FX'];

export default function RecordingStudio({
  bpm, totalBars, currentBar, onLayersChange, onAnalyserReady, onRecordingChange,
}: Props) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [recording, setRecording] = useState(false);
  const [recordingBar, setRecordingBar] = useState(1);
  const [layerName, setLayerName] = useState('');
  const [micError, setMicError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startBarRef = useRef(1);
  const startTimeRef = useRef(0);

  const updateLayers = useCallback((updated: Layer[]) => {
    setLayers(updated);
    onLayersChange(updated);
  }, [onLayersChange]);

  const startRecording = useCallback(async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      const ctx = new AudioContext();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;
      onAnalyserReady(analyser);

      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };

      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        const barsRecorded = Math.ceil((elapsed / 60) * bpm / 4);

        const name = layerName.trim() || LAYER_NAMES[layers.length % LAYER_NAMES.length];
        const color = LAYER_COLORS[layers.length % LAYER_COLORS.length];

        const newLayer: Layer = {
          id: `layer-${Date.now()}`,
          name,
          color,
          start_bar: startBarRef.current,
          duration_bars: Math.max(1, barsRecorded),
          muted: false,
          blob,
          url,
          duration_sec: elapsed,
        };

        updateLayers((prev) => [...prev, newLayer]);
        stream.getTracks().forEach((t) => t.stop());
        onAnalyserReady(null);
      };

      startBarRef.current = currentBar;
      startTimeRef.current = Date.now();
      mr.start(100);
      setRecording(true);
      setRecordingBar(currentBar);
      onRecordingChange(true);
    } catch (err: any) {
      setMicError(err.message || 'Could not access microphone');
    }
  }, [bpm, currentBar, layerName, layers.length, onAnalyserReady, onRecordingChange, updateLayers]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    onRecordingChange(false);
  }, [onRecordingChange]);

  const toggleMute = useCallback((id: string) => {
    updateLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, muted: !l.muted } : l))
    );
  }, [updateLayers]);

  const deleteLayer = useCallback((id: string) => {
    updateLayers((prev) => {
      const layer = prev.find((l) => l.id === id);
      if (layer?.url) URL.revokeObjectURL(layer.url);
      return prev.filter((l) => l.id !== id);
    });
  }, [updateLayers]);

  const playLayer = useCallback((layer: Layer) => {
    if (layer.url) {
      const audio = new Audio(layer.url);
      audio.play();
    }
  }, []);

  const downloadLayer = useCallback((layer: Layer) => {
    if (!layer.url) return;
    const a = document.createElement('a');
    a.href = layer.url;
    a.download = `${layer.name.replace(/\s+/g, '_')}.webm`;
    a.click();
  }, []);

  return (
    <div className="bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Recording Studio</span>
        <span className="text-xs text-gray-500">{bpm} BPM · {totalBars} bars</span>
      </div>

      {/* Record controls */}
      <div className="px-4 py-3 border-b border-gray-800 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={layerName}
          onChange={(e) => setLayerName(e.target.value)}
          placeholder="Layer name (e.g. Guitar)"
          disabled={recording}
          className="text-sm bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 w-40 focus:outline-none focus:ring-1 focus:ring-red-500 placeholder-gray-500"
        />
        <button
          onClick={recording ? stopRecording : startRecording}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
            recording
              ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse'
              : 'bg-red-500 hover:bg-red-600 text-white'
          }`}
        >
          <span className={`w-3 h-3 rounded-full ${recording ? 'bg-white animate-ping' : 'bg-red-200'}`} />
          {recording ? `Recording… bar ${recordingBar}→` : 'Record'}
        </button>

        {recording && (
          <span className="text-xs text-red-400 animate-pulse">
            Recording from bar {recordingBar} — play or sing now
          </span>
        )}

        {micError && (
          <span className="text-xs text-red-400">{micError}</span>
        )}
      </div>

      {/* Layer list */}
      <div className="divide-y divide-gray-800/50">
        {layers.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-600 text-sm">
            No layers yet — hit Record to capture your first instrument
          </div>
        )}
        {layers.map((layer) => (
          <div key={layer.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="w-2.5 h-8 rounded-sm flex-shrink-0" style={{ backgroundColor: layer.color }} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white truncate">{layer.name}</div>
              <div className="text-xs text-gray-500">
                Bar {layer.start_bar} · {layer.duration_bars} bars · {layer.duration_sec.toFixed(1)}s
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => playLayer(layer)}
                title="Preview"
                className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs"
              >
                ▶
              </button>
              <button
                onClick={() => toggleMute(layer.id)}
                title={layer.muted ? 'Unmute' : 'Mute'}
                className={`w-7 h-7 flex items-center justify-center rounded text-xs ${
                  layer.muted ? 'bg-yellow-800 text-yellow-300' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                }`}
              >
                {layer.muted ? 'M' : '◉'}
              </button>
              <button
                onClick={() => downloadLayer(layer)}
                title="Download"
                className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs"
              >
                ↓
              </button>
              <button
                onClick={() => deleteLayer(layer.id)}
                title="Delete"
                className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 hover:bg-red-900 text-gray-400 hover:text-red-400 text-xs"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      {layers.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-500">
          {layers.length} layer{layers.length !== 1 ? 's' : ''} recorded · {layers.filter((l) => !l.muted).length} active
        </div>
      )}
    </div>
  );
}
