import React, { useState, useCallback, useRef } from 'react';

interface Sample {
  id: string;
  name: string;
  type: 'loop' | 'one-shot' | 'stem' | 'fx';
  duration_sec: number;
  bpm?: number;
  key?: string;
  url: string;
  size_kb: number;
  tags: string[];
}

interface Props {
  songBpm: number;
  songKey: string;
  onAddLayer: (_sample: Sample, _startBar: number) => void;
}

const TYPE_COLORS: Record<string, string> = {
  loop:     'bg-indigo-800 text-indigo-200',
  'one-shot': 'bg-purple-800 text-purple-200',
  stem:     'bg-pink-800 text-pink-200',
  fx:       'bg-gray-700 text-gray-300',
};

function formatSize(kb: number) {
  return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}

export default function SampleLibrary({ songBpm, songKey: _songKey, onAddLayer }: Props) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [dragging, setDragging] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [stemming, setStemming] = useState<string | null>(null);
  const [stemResult, setStemResult] = useState<Record<string, string[]>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('audio/')) return;
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);
      audio.onloadedmetadata = () => {
        const sample: Sample = {
          id: `sample-${Date.now()}-${Math.random()}`,
          name: file.name.replace(/\.[^.]+$/, ''),
          type: file.name.includes('loop') || file.name.includes('drum')
            ? 'loop'
            : file.name.includes('stem')
            ? 'stem'
            : file.name.includes('fx') || file.name.includes('hit')
            ? 'fx'
            : 'one-shot',
          duration_sec: audio.duration,
          url,
          size_kb: Math.round(file.size / 1024),
          tags: [],
          bpm: undefined,
          key: undefined,
        };
        setSamples((prev) => [...prev, sample]);
      };
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const playSample = useCallback((sample: Sample) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (playing === sample.id) {
      setPlaying(null);
      return;
    }
    const audio = new Audio(sample.url);
    audio.onended = () => setPlaying(null);
    audio.play();
    audioRef.current = audio;
    setPlaying(sample.id);
  }, [playing]);

  const runStemSeparation = useCallback(async (sample: Sample) => {
    setStemming(sample.id);
    // Stem separation requires a backend ML service (e.g. Demucs).
    // This stub shows the UI flow — wire in your separation endpoint.
    await new Promise((r) => setTimeout(r, 2000));

    const stems = ['drums', 'bass', 'vocals', 'other'].map((part) => `${sample.name} [${part}]`);
    setStemResult((prev) => ({ ...prev, [sample.id]: stems }));
    setStemming(null);
  }, []);

  const visible = filter === 'all' ? samples : samples.filter((s) => s.type === filter);

  return (
    <div className="bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Sample Library</span>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-xs px-3 py-1 bg-indigo-700 text-white rounded-lg hover:bg-indigo-600"
        >
          + Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        className={`mx-4 my-3 border-2 border-dashed rounded-lg py-5 text-center text-xs transition-colors ${
          dragging
            ? 'border-indigo-500 bg-indigo-950/40 text-indigo-300'
            : 'border-gray-700 text-gray-500'
        }`}
      >
        Drop WAV / MP3 / AIFF files here, or click Import above
      </div>

      {/* Filter tabs */}
      {samples.length > 0 && (
        <div className="flex gap-2 px-4 mb-3">
          {['all', 'loop', 'one-shot', 'stem', 'fx'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                filter === f
                  ? 'bg-gray-700 text-white border-gray-600'
                  : 'bg-transparent text-gray-500 border-gray-700 hover:border-gray-500'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {/* Sample list */}
      <div className="divide-y divide-gray-800/50 max-h-72 overflow-y-auto">
        {visible.length === 0 && samples.length > 0 && (
          <div className="px-4 py-4 text-center text-gray-600 text-xs">No {filter} samples</div>
        )}
        {visible.map((sample) => (
          <div key={sample.id} className="px-4 py-2.5">
            <div className="flex items-center gap-2">
              <button
                onClick={() => playSample(sample)}
                className={`w-7 h-7 flex items-center justify-center rounded text-xs flex-shrink-0 ${
                  playing === sample.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                }`}
              >
                {playing === sample.id ? '■' : '▶'}
              </button>

              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{sample.name}</div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${TYPE_COLORS[sample.type]}`}>
                    {sample.type}
                  </span>
                  <span>{sample.duration_sec.toFixed(1)}s</span>
                  <span>{formatSize(sample.size_kb)}</span>
                  {sample.bpm && <span>{sample.bpm} BPM</span>}
                </div>
              </div>

              <div className="flex gap-1">
                <button
                  onClick={() => runStemSeparation(sample)}
                  disabled={stemming === sample.id}
                  title="Separate stems"
                  className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-pink-900 text-gray-300 hover:text-pink-300 disabled:opacity-50"
                >
                  {stemming === sample.id ? '…' : 'Stems'}
                </button>
                <button
                  onClick={() => onAddLayer({
                    ...sample,
                    id: `layer-${sample.id}`,
                    name: sample.name,
                    duration_bars: Math.ceil((sample.duration_sec / 60) * songBpm / 4),
                  } as any, 1)}
                  className="text-xs px-2 py-1 rounded bg-indigo-800 hover:bg-indigo-700 text-indigo-200"
                >
                  + Track
                </button>
              </div>
            </div>

            {/* Stem results */}
            {stemResult[sample.id] && (
              <div className="mt-2 pl-9 flex flex-wrap gap-1.5">
                {stemResult[sample.id].map((stem) => (
                  <span key={stem} className="text-xs px-2 py-0.5 bg-pink-900/50 text-pink-300 rounded">
                    {stem}
                  </span>
                ))}
                <span className="text-xs text-gray-600 self-center">
                  (Connect Demucs to enable real separation)
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
