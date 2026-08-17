import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import DescriptionInput from '../components/song-composer/DescriptionInput';
import ArrangementTimeline from '../components/song-composer/ArrangementTimeline';
import WaveformSpectrum from '../components/song-composer/WaveformSpectrum';
import SongStructure from '../components/song-composer/SongStructure';
import CopilotPanel from '../components/song-composer/CopilotPanel';
import RecordingStudio from '../components/song-composer/RecordingStudio';
import SampleLibrary from '../components/song-composer/SampleLibrary';
import LiveSetPanel from '../components/song-composer/LiveSetPanel';
import MixdownPanel from '../components/song-composer/MixdownPanel';
import MidiStatusBar from '../components/song-composer/MidiStatusBar';
import { midiInterface, MidiDevice, MidiAction } from '../components/song-composer/MidiControllerInterface';

type MainTab = 'compose' | 'record' | 'samples' | 'liveset';

interface Layer {
  id: string;
  name: string;
  color: string;
  start_bar: number;
  duration_bars: number;
  muted: boolean;
  blob?: Blob;
  url?: string;
  duration_sec?: number;
  gain?: number;
}

export default function SongComposer() {
  const [song, setSong]           = useState<any>(null);
  const [generating, setGenerating] = useState(false);
  const [tab, setTab]             = useState<MainTab>('compose');
  const [currentBar, setCurrentBar] = useState(1);
  const [playing, setPlaying]     = useState(false);
  const [recording, setRecording] = useState(false);
  const [layers, setLayers]       = useState<Layer[]>([]);
  const [analyser, setAnalyser]   = useState<AnalyserNode | null>(null);
  const [activeSection, setActiveSection] = useState<any>(null);
  const [showMixdown, setShowMixdown]     = useState(false);
  const [midiConnected, setMidiConnected] = useState(false);
  const [midiDevices, setMidiDevices]     = useState<MidiDevice[]>([]);
  const [midiLastAction, setMidiLastAction] = useState<string | null>(null);
  const [midiMapping, setMidiMapping]       = useState<Record<string, any>>({});
  const [, setMidiFlash]                    = useState<string | null>(null); // section id to flash

  const playIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const metronomeRef     = useRef<{ ctx: AudioContext; schedule: (_bar: number) => void } | null>(null);
  const midiActionLabelRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Playback ticker ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing || !song) return;
    const secPerBar = (60 / song.bpm) * 4;
    playIntervalRef.current = setInterval(() => {
      setCurrentBar((bar) => (bar >= song.total_bars ? 1 : bar + 1));
    }, secPerBar * 1000);
    return () => { if (playIntervalRef.current) clearInterval(playIntervalRef.current); };
  }, [playing, song]);

  // ── Active section tracker ───────────────────────────────────────────────────
  useEffect(() => {
    if (!song) return;
    const sec = song.sections?.find(
      (s: any) => currentBar >= s.start_bar && currentBar < s.start_bar + s.bars
    );
    setActiveSection(sec || null);
  }, [currentBar, song]);

  // ── Metronome (Web Audio API) ────────────────────────────────────────────────
  const initMetronome = useCallback((_bpm: number) => {
    const ctx = new AudioContext();
    const schedule = (bar: number) => {
      const isDownBeat = (bar - 1) % 4 === 0;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = isDownBeat ? 1320 : 880;
      gain.gain.setValueAtTime(isDownBeat ? 0.25 : 0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.05);
    };
    metronomeRef.current = { ctx, schedule };
  }, []);

  // Click on each bar advance
  useEffect(() => {
    if (playing && metronomeRef.current) {
      metronomeRef.current.schedule(currentBar);
    }
  }, [currentBar, playing]);

  // ── MIDI handler ─────────────────────────────────────────────────────────────
  const handleMidiAction = useCallback((action: MidiAction) => {
    const label = (text: string) => {
      setMidiLastAction(text);
      if (midiActionLabelRef.current) clearTimeout(midiActionLabelRef.current);
      midiActionLabelRef.current = setTimeout(() => setMidiLastAction(null), 2000);
    };

    if (action.type === 'section_jump' && song && action.value !== undefined) {
      const sec = song.sections[action.value];
      if (sec) {
        setCurrentBar(sec.start_bar);
        setMidiFlash(sec.id);
        setTimeout(() => setMidiFlash(null), 600);
        label(`→ ${sec.name}`);
      }
    } else if (action.type === 'play') {
      setPlaying(true);
      label('▶ Play');
    } else if (action.type === 'pause') {
      setPlaying(false);
      label('⏸ Pause');
    } else if (action.type === 'seek_start') {
      setCurrentBar(1);
      label('⏮ Rewind');
    } else if (action.type === 'seek_end') {
      setCurrentBar(song?.total_bars || 1);
      label('⏭ End');
    } else if (action.type === 'record_toggle') {
      label('⏺ Record toggle');
    } else if (action.type === 'pad_custom') {
      label(`Pad note ${action.rawNote}`);
    }
  }, [song]);

  // ── Connect MIDI ─────────────────────────────────────────────────────────────
  const connectMidi = useCallback(async () => {
    const devices = await midiInterface.initialize(
      handleMidiAction,
      (devs) => {
        setMidiDevices(devs);
        setMidiMapping(midiInterface.getMapping());
      }
    );
    if (devices.length > 0) {
      setMidiConnected(true);
      setMidiDevices(devices);
      setMidiMapping(midiInterface.getMapping());
    }
  }, [handleMidiAction]);

  // ── Learn pad ────────────────────────────────────────────────────────────────
  const handleLearnPad = useCallback(async (sectionIndex: number, sectionName: string) => {
    const { note, channel } = await midiInterface.learnNextPad();
    const statusByte = 0x90 | (channel & 0x0F);
    midiInterface.mapPadToSection(statusByte, note, sectionIndex, sectionName);
    setMidiMapping(midiInterface.getMapping());
  }, []);

  // ── Song generate ─────────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async (description: string, style: string) => {
    setGenerating(true);
    try {
      const res  = await fetch('/api/song-composer/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, style }),
      });
      const data = await res.json();
      if (data.ok) {
        setSong(data.song);
        setCurrentBar(1);
        setPlaying(false);
        initMetronome(data.song.bpm);
        // Push default section mappings to MIDI
        data.song.sections?.forEach((sec: any, i: number) => {
          if (i < 8) midiInterface.setMapping(0x95, i, 'section_jump', i, `Cue A${i + 1} → ${sec.name}`);
        });
        setMidiMapping(midiInterface.getMapping());
      }
    } finally {
      setGenerating(false);
    }
  }, [initMetronome]);

  const togglePlay = useCallback(() => {
    if (!song) return;
    if (!metronomeRef.current) initMetronome(song.bpm);
    setPlaying((v) => !v);
  }, [song, initMetronome]);

  const handleAddSampleLayer = useCallback((sample: any, startBar: number) => {
    setLayers((prev) => [...prev, {
      id: `sample-${sample.id}`,
      name: sample.name,
      color: '#ec4899',
      start_bar: startBar,
      duration_bars: sample.duration_bars || 4,
      muted: false,
    }]);
  }, []);

  // Mixdown-ready layers (only those with blobs)
  const mixdownLayers = layers.filter((l): l is Layer & { blob: Blob } => !!l.blob);

  const tabs: { id: MainTab; label: string; dot?: boolean }[] = [
    { id: 'compose', label: 'Compose' },
    { id: 'record',  label: 'Record', dot: recording },
    { id: 'samples', label: 'Samples' },
    { id: 'liveset', label: 'Live Set' },
  ];

  return (
    <div className="min-h-screen bg-black text-white">

      {/* ── Nav bar ── */}
      <nav className="bg-gray-950 border-b border-gray-800 px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <Link href="/" className="text-gray-500 hover:text-gray-300 text-sm">← Heidi</Link>
        <Link href="/agent-manager" className="text-gray-500 hover:text-gray-300 text-sm">Agents</Link>
        <span className="text-gray-700">|</span>
        <h1 className="font-bold text-white">Song Composer</h1>
        {song && <span className="text-xs text-purple-400 font-medium">{song.title}</span>}

        {/* Transport */}
        {song && (
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {/* MIDI status */}
            <MidiStatusBar
              supported={midiInterface.isSupported()}
              connected={midiConnected}
              devices={midiDevices}
              lastAction={midiLastAction}
              mapping={midiMapping}
              onConnect={connectMidi}
              onLearnPad={handleLearnPad}
              sections={song.sections || []}
            />

            <span className="text-xs text-gray-500 font-mono">
              {String(currentBar).padStart(3, ' ')}/{song.total_bars}
            </span>

            {/* Rewind */}
            <button
              onClick={() => setCurrentBar(1)}
              className="w-8 h-8 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs"
              title="Rewind"
            >
              ⏮
            </button>

            {/* Play / Pause */}
            <button
              onClick={togglePlay}
              className={`w-9 h-9 flex items-center justify-center rounded-full text-sm font-bold transition-colors ${
                playing
                  ? 'bg-yellow-500 hover:bg-yellow-400 text-black'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
              title={playing ? 'Pause' : 'Play'}
            >
              {playing ? '⏸' : '▶'}
            </button>

            {/* REC indicator */}
            {recording && (
              <span className="flex items-center gap-1.5 text-xs text-red-400 font-semibold">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                REC
              </span>
            )}

            {/* Mixdown */}
            <button
              onClick={() => setShowMixdown(true)}
              disabled={mixdownLayers.length === 0}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-indigo-700 text-indigo-300 hover:bg-indigo-900/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={mixdownLayers.length === 0 ? 'Record layers first' : `Export ${mixdownLayers.length} layer(s) to WAV`}
            >
              ↓ Mixdown
              {mixdownLayers.length > 0 && (
                <span className="w-4 h-4 flex items-center justify-center rounded-full bg-indigo-700 text-white text-xs font-bold">
                  {mixdownLayers.length}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Connect MIDI when no song loaded yet */}
        {!song && (
          <div className="ml-auto">
            <MidiStatusBar
              supported={midiInterface.isSupported()}
              connected={midiConnected}
              devices={midiDevices}
              lastAction={midiLastAction}
              mapping={midiMapping}
              onConnect={connectMidi}
              onLearnPad={handleLearnPad}
              sections={[]}
            />
          </div>
        )}
      </nav>

      {/* ── Tab bar ── */}
      <div className="bg-gray-950 border-b border-gray-800 px-4">
        <div className="flex">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-purple-500 text-purple-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.label}
              {t.dot && (
                <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main content ── */}
      <main className="max-w-screen-2xl mx-auto px-4 py-5 space-y-4">

        {/* ───────────────── COMPOSE TAB ───────────────── */}
        {tab === 'compose' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

            {/* Left: description + structure */}
            <div className="xl:col-span-1 space-y-4">
              <DescriptionInput onGenerate={handleGenerate} loading={generating} />
              {song && (
                <SongStructure
                  song={song}
                  currentBar={currentBar}
                  onSectionJump={(bar) => { setCurrentBar(bar); }}
                />
              )}
            </div>

            {/* Right: visualizers + copilot */}
            <div className="xl:col-span-2 space-y-4">
              {song ? (
                <>
                  <ArrangementTimeline
                    sections={song.sections}
                    layers={layers}
                    totalBars={song.total_bars}
                    bpm={song.bpm}
                    currentBar={currentBar}
                    playing={playing}
                    onSeek={setCurrentBar}
                    onSectionClick={setActiveSection}
                  />

                  <WaveformSpectrum
                    analyserNode={analyser}
                    recording={recording}
                    playing={playing}
                  />

                  {/* Chord overlay + lyric scroll */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Chord overlay */}
                    <div className="bg-gray-950 rounded-xl border border-gray-800 p-4">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Current Chord</p>
                      {activeSection ? (
                        <div>
                          <div
                            className="text-4xl font-black mb-2 transition-all"
                            style={{ color: activeSection.color }}
                          >
                            {activeSection.chords[
                              Math.floor(((currentBar - activeSection.start_bar) / 2)) %
                              Math.max(1, activeSection.chords.length)
                            ] ?? activeSection.chords[0]}
                          </div>
                          <p className="text-xs text-gray-500">{activeSection.name} · Bar {currentBar}</p>
                          <div className="flex gap-1.5 mt-2 flex-wrap">
                            {activeSection.chords.map((c: string, i: number) => (
                              <span
                                key={i}
                                className="text-xs px-2 py-0.5 rounded font-mono"
                                style={{
                                  background: `${activeSection.color}22`,
                                  color: activeSection.color,
                                  border: `1px solid ${activeSection.color}44`,
                                }}
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-gray-600 text-sm">Press play to track chords</p>
                      )}
                    </div>

                    {/* Lyric scroll */}
                    <div className="bg-gray-950 rounded-xl border border-gray-800 p-4">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Lyrics</p>
                      <div className="space-y-1.5 max-h-28 overflow-y-auto">
                        {song.lyrics?.length > 0 ? (
                          song.lyrics.map((l: any, i: number) => (
                            <div
                              key={i}
                              className={`text-sm transition-all duration-300 ${
                                Math.abs(l.bar - currentBar) < 2
                                  ? 'text-white font-semibold'
                                  : l.bar < currentBar
                                  ? 'text-gray-700'
                                  : 'text-gray-500'
                              }`}
                            >
                              <span className="text-xs text-gray-700 font-mono mr-2 w-8 inline-block">b{l.bar}</span>
                              {l.text}
                            </div>
                          ))
                        ) : (
                          <p className="text-gray-600 text-sm">No lyrics generated</p>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-64 bg-gray-950 rounded-xl border border-dashed border-gray-800">
                  <div className="text-center text-gray-600">
                    <div className="text-5xl mb-3">♪</div>
                    <p className="text-sm">Describe a song idea to get started</p>
                  </div>
                </div>
              )}

              <CopilotPanel song={song} currentBar={currentBar} />
            </div>
          </div>
        )}

        {/* ───────────────── RECORD TAB ───────────────── */}
        {tab === 'record' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 space-y-4">
              {song && (
                <ArrangementTimeline
                  sections={song.sections}
                  layers={layers}
                  totalBars={song.total_bars}
                  bpm={song.bpm}
                  currentBar={currentBar}
                  playing={playing || recording}
                  onSeek={setCurrentBar}
                  onSectionClick={setActiveSection}
                />
              )}
              <WaveformSpectrum
                analyserNode={analyser}
                recording={recording}
                playing={playing}
                color="#f43f5e"
              />
              <RecordingStudio
                bpm={song?.bpm || 120}
                totalBars={song?.total_bars || 64}
                currentBar={currentBar}
                onLayersChange={setLayers}
                onAnalyserReady={setAnalyser}
                onRecordingChange={setRecording}
              />

              {/* Mixdown CTA */}
              {mixdownLayers.length > 0 && (
                <div className="flex items-center justify-between bg-indigo-950/40 border border-indigo-800/50 rounded-xl px-4 py-3">
                  <div className="text-sm text-indigo-300">
                    <span className="font-semibold">{mixdownLayers.length} layer{mixdownLayers.length !== 1 ? 's' : ''}</span> ready to export
                  </div>
                  <button
                    onClick={() => setShowMixdown(true)}
                    className="text-sm px-4 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 font-semibold"
                  >
                    ↓ Export Mixdown
                  </button>
                </div>
              )}
            </div>
            <div>
              <CopilotPanel song={song} currentBar={currentBar} />
            </div>
          </div>
        )}

        {/* ───────────────── SAMPLES TAB ───────────────── */}
        {tab === 'samples' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2">
              <SampleLibrary
                songBpm={song?.bpm || 120}
                songKey={song?.key || 'C major'}
                onAddLayer={handleAddSampleLayer}
              />
            </div>
            <div>
              <CopilotPanel song={song} currentBar={currentBar} />
            </div>
          </div>
        )}

        {/* ───────────────── LIVE SET TAB ───────────────── */}
        {tab === 'liveset' && <LiveSetPanel currentSong={song} />}
      </main>

      {/* ── Mixdown modal ── */}
      {showMixdown && (
        <MixdownPanel
          layers={mixdownLayers as any}
          bpm={song?.bpm || 120}
          songTitle={song?.title || 'Untitled'}
          onClose={() => setShowMixdown(false)}
        />
      )}
    </div>
  );
}
