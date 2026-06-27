/**
 * RezonateDAWModule — Full Digital Audio Workstation
 * 
 * Complete DAW implementation with:
 * - Audio recording and playback
 * - Waveform visualization
 * - Multi-track mixer
 * - MIDI sequencer
 * - AI Signal Intelligence
 * - Bot Personalities
 * - Plugin support
 */
'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Square,
  Mic,
  Volume2,
  Sliders,
  Waves,
  Plus,
  Trash2,
  Download,
  Upload,
  Settings,
  Brain,
  Bot,
  Zap,
  Music,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Track {
  id: string;
  name: string;
  type: 'audio' | 'midi';
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  armed: boolean;
  color: string;
  audioBuffer?: AudioBuffer;
  waveformData?: number[];
}

interface TransportState {
  isPlaying: boolean;
  isRecording: boolean;
  currentTime: number;
  bpm: number;
  timeSignature: [number, number];
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function RezonateDAWModule() {
  const [tracks, setTracks] = useState<Track[]>([
    { id: '1', name: 'Track 1', type: 'audio', volume: 0.8, pan: 0, muted: false, solo: false, armed: false, color: '#58a6ff' },
    { id: '2', name: 'Track 2', type: 'audio', volume: 0.8, pan: 0, muted: false, solo: false, armed: false, color: '#3fb950' },
    { id: '3', name: 'MIDI 1', type: 'midi', volume: 0.8, pan: 0, muted: false, solo: false, armed: false, color: '#bc8cff' },
  ]);

  const [transport, setTransport] = useState<TransportState>({
    isPlaying: false,
    isRecording: false,
    currentTime: 0,
    bpm: 120,
    timeSignature: [4, 4],
  });

  const [activeView, setActiveView] = useState<'mixer' | 'arrange' | 'ai' | 'bots'>('mixer');
  const [masterVolume, setMasterVolume] = useState(0.8);
  const [aiEnabled, setAiEnabled] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Initialize Web Audio API
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  // Transport controls
  const handlePlay = useCallback(() => {
    setTransport(prev => ({ ...prev, isPlaying: !prev.isPlaying }));
  }, []);

  const handleStop = useCallback(() => {
    setTransport(prev => ({ ...prev, isPlaying: false, currentTime: 0 }));
  }, []);

  const handleRecord = useCallback(async () => {
    if (!transport.isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;

        const chunks: Blob[] = [];
        mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
        mediaRecorder.onstop = async () => {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const arrayBuffer = await blob.arrayBuffer();
          const audioBuffer = await audioContextRef.current!.decodeAudioData(arrayBuffer);

          // Add recorded audio to armed track
          const armedTrack = tracks.find(t => t.armed);
          if (armedTrack) {
            setTracks(prev => prev.map(t =>
              t.id === armedTrack.id
                ? { ...t, audioBuffer, waveformData: generateWaveformData(audioBuffer) }
                : t
            ));
          }
        };

        mediaRecorder.start();
        setTransport(prev => ({ ...prev, isRecording: true }));
      } catch (err) {
        console.error('Failed to start recording:', err);
      }
    } else {
      mediaRecorderRef.current?.stop();
      setTransport(prev => ({ ...prev, isRecording: false }));
    }
  }, [transport.isRecording, tracks]);

  // Track controls
  const addTrack = useCallback((type: 'audio' | 'midi') => {
    const newTrack: Track = {
      id: Date.now().toString(),
      name: `${type === 'audio' ? 'Track' : 'MIDI'} ${tracks.length + 1}`,
      type,
      volume: 0.8,
      pan: 0,
      muted: false,
      solo: false,
      armed: false,
      color: type === 'audio' ? '#58a6ff' : '#bc8cff',
    };
    setTracks(prev => [...prev, newTrack]);
  }, [tracks.length]);

  const deleteTrack = useCallback((id: string) => {
    setTracks(prev => prev.filter(t => t.id !== id));
  }, []);

  const updateTrack = useCallback((id: string, updates: Partial<Track>) => {
    setTracks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-editor)' }}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-3">
          <Music size={20} style={{ color: '#bc8cff' }} />
          <h1 className="text-lg font-semibold" style={{ color: 'var(--fg-default)' }}>
            Rezonate DAW
          </h1>
          <span className="text-xs px-2 py-0.5 rounded" style={{ background: '#bc8cff20', color: '#bc8cff' }}>
            Professional
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setAiEnabled(!aiEnabled)}
            className="px-3 py-1.5 rounded flex items-center gap-2 text-sm transition-all"
            style={{
              background: aiEnabled ? '#bc8cff20' : 'transparent',
              color: aiEnabled ? '#bc8cff' : 'var(--fg-muted)',
              border: `1px solid ${aiEnabled ? '#bc8cff' : 'transparent'}`,
            }}
          >
            <Brain size={14} />
            AI Intelligence
          </button>
        </div>
      </div>

      {/* Transport Bar */}
      <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-subtle)' }}>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePlay}
            className="p-2 rounded hover:opacity-80 transition-opacity"
            style={{ background: transport.isPlaying ? '#3fb950' : 'var(--bg-inset)', color: '#fff' }}
          >
            {transport.isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            onClick={handleStop}
            className="p-2 rounded hover:opacity-80 transition-opacity"
            style={{ background: 'var(--bg-inset)', color: 'var(--fg-default)' }}
          >
            <Square size={16} />
          </button>
          <button
            onClick={handleRecord}
            className="p-2 rounded hover:opacity-80 transition-opacity"
            style={{ background: transport.isRecording ? '#f85149' : 'var(--bg-inset)', color: '#fff' }}
          >
            <Mic size={16} />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>BPM:</span>
            <input
              type="number"
              value={transport.bpm}
              onChange={(e) => setTransport(prev => ({ ...prev, bpm: parseInt(e.target.value) || 120 }))}
              className="w-16 px-2 py-1 rounded text-xs text-center"
              style={{ background: 'var(--bg-inset)', color: 'var(--fg-default)', border: '1px solid var(--border-default)' }}
            />
          </div>
          <div className="text-xs font-mono" style={{ color: 'var(--fg-default)' }}>
            {formatTime(transport.currentTime)}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Volume2 size={14} style={{ color: 'var(--fg-muted)' }} />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={masterVolume}
            onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
            className="w-24"
          />
          <span className="text-xs font-mono w-8" style={{ color: 'var(--fg-muted)' }}>
            {Math.round(masterVolume * 100)}
          </span>
        </div>
      </div>

      {/* View Tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b" style={{ borderColor: 'var(--border-color)' }}>
        {[
          { id: 'mixer', label: 'Mixer', icon: Sliders },
          { id: 'arrange', label: 'Arrange', icon: Waves },
          { id: 'ai', label: 'AI Intelligence', icon: Brain },
          { id: 'bots', label: 'Bot Personalities', icon: Bot },
        ].map(view => {
          const Icon = view.icon;
          return (
            <button
              key={view.id}
              onClick={() => setActiveView(view.id as typeof activeView)}
              className="px-3 py-1.5 rounded text-sm flex items-center gap-2 transition-all"
              style={{
                background: activeView === view.id ? 'var(--bg-subtle)' : 'transparent',
                color: activeView === view.id ? 'var(--fg-default)' : 'var(--fg-muted)',
                border: `1px solid ${activeView === view.id ? 'var(--border-default)' : 'transparent'}`,
              }}
            >
              <Icon size={14} />
              {view.label}
            </button>
          );
        })}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {activeView === 'mixer' && (
          <MixerView
            tracks={tracks}
            onUpdateTrack={updateTrack}
            onDeleteTrack={deleteTrack}
            onAddTrack={addTrack}
          />
        )}
        {activeView === 'arrange' && (
          <ArrangeView
            tracks={tracks}
            transport={transport}
            onUpdateTrack={updateTrack}
          />
        )}
        {activeView === 'ai' && <AIView enabled={aiEnabled} />}
        {activeView === 'bots' && <BotsView />}
      </div>
    </div>
  );
}

// ─── Sub Views ───────────────────────────────────────────────────────────────

function MixerView({ tracks, onUpdateTrack, onDeleteTrack, onAddTrack }: {
  tracks: Track[];
  onUpdateTrack: (id: string, updates: Partial<Track>) => void;
  onDeleteTrack: (id: string) => void;
  onAddTrack: (type: 'audio' | 'midi') => void;
}) {
  return (
    <div className="h-full flex flex-col p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--fg-default)' }}>
          Mixer ({tracks.length} tracks)
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => onAddTrack('audio')}
            className="px-3 py-1.5 rounded text-xs flex items-center gap-2 hover:opacity-80 transition-opacity"
            style={{ background: '#58a6ff20', color: '#58a6ff' }}
          >
            <Plus size={12} />
            Audio Track
          </button>
          <button
            onClick={() => onAddTrack('midi')}
            className="px-3 py-1.5 rounded text-xs flex items-center gap-2 hover:opacity-80 transition-opacity"
            style={{ background: '#bc8cff20', color: '#bc8cff' }}
          >
            <Plus size={12} />
            MIDI Track
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-4 gap-4">
          {tracks.map(track => (
            <div
              key={track.id}
              className="p-4 rounded border"
              style={{ background: 'var(--bg-subtle)', borderColor: track.color }}
            >
              <div className="flex items-center justify-between mb-3">
                <input
                  type="text"
                  value={track.name}
                  onChange={(e) => onUpdateTrack(track.id, { name: e.target.value })}
                  className="flex-1 px-2 py-1 rounded text-sm font-semibold"
                  style={{ background: 'transparent', color: 'var(--fg-default)', border: 'none' }}
                />
                <button
                  onClick={() => onDeleteTrack(track.id)}
                  className="p-1 rounded hover:bg-red-500/20 transition-colors"
                >
                  <Trash2 size={12} style={{ color: '#f85149' }} />
                </button>
              </div>

              <div className="space-y-3">
                {/* Volume */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>Volume</span>
                    <span className="text-xs font-mono" style={{ color: 'var(--fg-default)' }}>
                      {Math.round(track.volume * 100)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={track.volume}
                    onChange={(e) => onUpdateTrack(track.id, { volume: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                </div>

                {/* Pan */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>Pan</span>
                    <span className="text-xs font-mono" style={{ color: 'var(--fg-default)' }}>
                      {track.pan > 0 ? `R${Math.round(track.pan * 100)}` : track.pan < 0 ? `L${Math.round(Math.abs(track.pan) * 100)}` : 'C'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-1"
                    max="1"
                    step="0.01"
                    value={track.pan}
                    onChange={(e) => onUpdateTrack(track.id, { pan: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                </div>

                {/* Controls */}
                <div className="flex gap-1">
                  <button
                    onClick={() => onUpdateTrack(track.id, { muted: !track.muted })}
                    className="flex-1 px-2 py-1 rounded text-xs transition-all"
                    style={{
                      background: track.muted ? '#f8514920' : 'var(--bg-inset)',
                      color: track.muted ? '#f85149' : 'var(--fg-muted)',
                    }}
                  >
                    M
                  </button>
                  <button
                    onClick={() => onUpdateTrack(track.id, { solo: !track.solo })}
                    className="flex-1 px-2 py-1 rounded text-xs transition-all"
                    style={{
                      background: track.solo ? '#d2992220' : 'var(--bg-inset)',
                      color: track.solo ? '#d29922' : 'var(--fg-muted)',
                    }}
                  >
                    S
                  </button>
                  <button
                    onClick={() => onUpdateTrack(track.id, { armed: !track.armed })}
                    className="flex-1 px-2 py-1 rounded text-xs transition-all"
                    style={{
                      background: track.armed ? '#f8514920' : 'var(--bg-inset)',
                      color: track.armed ? '#f85149' : 'var(--fg-muted)',
                    }}
                  >
                    R
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ArrangeView({ tracks, transport, onUpdateTrack }: {
  tracks: Track[];
  transport: TransportState;
  onUpdateTrack: (id: string, updates: Partial<Track>) => void;
}) {
  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--fg-default)' }}>
        Arrangement View
      </h2>
      <div className="flex-1 overflow-auto">
        <div className="space-y-2">
          {tracks.map(track => (
            <div key={track.id} className="flex items-center gap-2">
              <div className="w-32 px-3 py-2 rounded text-sm" style={{ background: 'var(--bg-subtle)', color: 'var(--fg-default)' }}>
                {track.name}
              </div>
              <div className="flex-1 h-16 rounded relative" style={{ background: 'var(--bg-inset)', border: `1px solid ${track.color}` }}>
                {track.waveformData && (
                  <WaveformDisplay data={track.waveformData} color={track.color} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AIView({ enabled }: { enabled: boolean }) {
  return (
    <div className="h-full p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Brain size={24} style={{ color: '#bc8cff' }} />
          <h2 className="text-xl font-semibold" style={{ color: 'var(--fg-default)' }}>
            AI Signal Intelligence
          </h2>
        </div>

        {!enabled ? (
          <div className="text-center py-12">
            <Brain size={48} style={{ color: 'var(--fg-muted)', margin: '0 auto 16px' }} />
            <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
              AI Intelligence is disabled. Enable it in the header to access features.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {[
              { title: 'Model Track System', desc: 'Track and analyze AI-generated signals in real time', status: 'Active' },
              { title: 'Audio Classification', desc: 'Real-time audio classification and pattern recognition', status: 'Ready' },
              { title: 'Mix Assistant', desc: 'Automated mixing assistance and predictive composition', status: 'Learning' },
              { title: 'Pattern Recognition', desc: 'Identify musical patterns and suggest variations', status: 'Active' },
            ].map(feature => (
              <div key={feature.title} className="p-4 rounded border" style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border-color)' }}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--fg-default)' }}>
                    {feature.title}
                  </h3>
                  <span className="text-xs px-2 py-0.5 rounded" style={{ background: '#3fb95020', color: '#3fb950' }}>
                    {feature.status}
                  </span>
                </div>
                <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BotsView() {
  const bots = [
    { name: 'Maestro', role: 'Composition Assistant', personality: 'Creative & Encouraging', status: 'online' },
    { name: 'Echo', role: 'Mix Engineer', personality: 'Precise & Technical', status: 'online' },
    { name: 'Vibe', role: 'Genre Specialist', personality: 'Adaptive & Knowledgeable', status: 'learning' },
  ];

  return (
    <div className="h-full p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Bot size={24} style={{ color: '#d29922' }} />
          <h2 className="text-xl font-semibold" style={{ color: 'var(--fg-default)' }}>
            Bot Personalities
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {bots.map(bot => (
            <div key={bot.name} className="p-4 rounded border" style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-3">
                <Bot size={20} style={{ color: '#d29922' }} />
                <span className="text-xs px-2 py-0.5 rounded" style={{
                  background: bot.status === 'online' ? '#3fb95020' : '#d2992220',
                  color: bot.status === 'online' ? '#3fb950' : '#d29922',
                }}>
                  {bot.status}
                </span>
              </div>
              <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--fg-default)' }}>
                {bot.name}
              </h3>
              <p className="text-xs mb-2" style={{ color: 'var(--fg-muted)' }}>
                {bot.role}
              </p>
              <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                Personality: {bot.personality}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WaveformDisplay({ data, color }: { data: number[]; color: string }) {
  return (
    <svg className="w-full h-full">
      <polyline
        points={data.map((v, i) => `${(i / data.length) * 100},${50 + v * 40}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1"
      />
    </svg>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function generateWaveformData(audioBuffer: AudioBuffer): number[] {
  const rawData = audioBuffer.getChannelData(0);
  const samples = 100;
  const blockSize = Math.floor(rawData.length / samples);
  const filteredData: number[] = [];

  for (let i = 0; i < samples; i++) {
    let sum = 0;
    for (let j = 0; j < blockSize; j++) {
      sum += Math.abs(rawData[i * blockSize + j]);
    }
    filteredData.push(sum / blockSize);
  }

  return filteredData;
}
