import React, { useState, useEffect, useCallback } from 'react';

interface SavedSong {
  id: string;
  created_at: string;
  description: string;
  song: {
    title: string;
    bpm: number;
    key: string;
    genre: string;
    mood: string;
    total_bars: number;
    sections: any[];
  };
}

interface SetSlot {
  song: SavedSong;
  transitionType: 'cut' | 'blend' | 'beatmatch';
  notes: string;
}

interface Props {
  currentSong: any | null;
}

const KEY_COMPATIBILITY: Record<string, string[]> = {
  'C major': ['G major', 'F major', 'A minor', 'D minor'],
  'G major': ['D major', 'C major', 'E minor', 'A minor'],
  'D major': ['A major', 'G major', 'B minor', 'E minor'],
  'A major': ['E major', 'D major', 'F# minor', 'B minor'],
  'F major': ['C major', 'Bb major', 'D minor', 'G minor'],
  'A minor': ['E minor', 'D minor', 'C major', 'G major'],
  'E minor': ['B minor', 'A minor', 'G major', 'D major'],
};

function getBpmCompatibility(a: number, b: number): 'perfect' | 'double' | 'close' | 'different' {
  const ratio = a / b;
  if (Math.abs(ratio - 1) < 0.05) return 'perfect';
  if (Math.abs(ratio - 2) < 0.1 || Math.abs(ratio - 0.5) < 0.1) return 'double';
  if (Math.abs(ratio - 1) < 0.1) return 'close';
  return 'different';
}

const BPM_BADGE: Record<string, string> = {
  perfect:   'bg-green-800 text-green-200',
  double:    'bg-blue-800 text-blue-200',
  close:     'bg-yellow-800 text-yellow-200',
  different: 'bg-red-900 text-red-300',
};
const BPM_LABEL: Record<string, string> = {
  perfect: 'Perfect match', double: '2x tempo', close: 'Close', different: 'Needs work',
};

export default function LiveSetPanel({ currentSong }: Props) {
  const [savedSongs, setSavedSongs] = useState<SavedSong[]>([]);
  const [set, setSet] = useState<SetSlot[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSongs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/song-composer/songs?limit=20');
      const data = await res.json();
      if (data.ok) setSavedSongs(data.songs.filter((s: SavedSong) => s.song));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSongs(); }, [fetchSongs]);

  const addToSet = (song: SavedSong) => {
    if (set.find((s) => s.song.id === song.id)) return;
    setSet((prev) => [...prev, { song, transitionType: 'beatmatch', notes: '' }]);
  };

  const removeFromSet = (id: string) => {
    setSet((prev) => prev.filter((s) => s.song.id !== id));
  };

  const moveSlot = (index: number, dir: -1 | 1) => {
    setSet((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const updateTransition = (id: string, transitionType: SetSlot['transitionType']) => {
    setSet((prev) => prev.map((s) => s.song.id === id ? { ...s, transitionType } : s));
  };

  const totalDuration = set.reduce((sum, s) => sum + (s.song.song.total_bars / s.song.song.bpm) * 60 * 4, 0);
  const formatTime = (sec: number) => `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Available songs */}
      <div className="bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Song Library</span>
          <button onClick={fetchSongs} className="text-xs text-gray-500 hover:text-gray-300">Refresh</button>
        </div>

        {loading && (
          <div className="px-4 py-6 text-center text-gray-600 text-xs">Loading songs…</div>
        )}

        {!loading && savedSongs.length === 0 && (
          <div className="px-4 py-6 text-center text-gray-600 text-xs">
            Generate songs to build your set
          </div>
        )}

        <div className="divide-y divide-gray-800/50 max-h-80 overflow-y-auto">
          {savedSongs.map((s) => {
            const bpmCompat = currentSong ? getBpmCompatibility(s.song.bpm, currentSong.bpm) : null;
            const keyCompat = currentSong
              ? (KEY_COMPATIBILITY[currentSong.key] || []).includes(s.song.key)
              : null;
            const inSet = set.some((sl) => sl.song.id === s.id);

            return (
              <div key={s.id} className="px-4 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{s.song.title}</div>
                  <div className="flex gap-2 text-xs text-gray-500 mt-0.5">
                    <span>{s.song.bpm} BPM</span>
                    <span>{s.song.key}</span>
                    <span className="capitalize">{s.song.genre}</span>
                  </div>
                  {bpmCompat && (
                    <div className="flex gap-1.5 mt-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${BPM_BADGE[bpmCompat]}`}>
                        {BPM_LABEL[bpmCompat]}
                      </span>
                      {keyCompat !== null && (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${keyCompat ? 'bg-green-800 text-green-200' : 'bg-gray-800 text-gray-400'}`}>
                          {keyCompat ? 'Compatible key' : 'Different key'}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => addToSet(s)}
                  disabled={inSet}
                  className={`text-xs px-2.5 py-1 rounded-lg flex-shrink-0 ${
                    inSet
                      ? 'bg-gray-800 text-gray-600 cursor-default'
                      : 'bg-indigo-700 text-white hover:bg-indigo-600'
                  }`}
                >
                  {inSet ? 'In set' : '+ Set'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live set builder */}
      <div className="bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Live Set</span>
          {set.length > 0 && (
            <span className="text-xs text-gray-500">{set.length} songs · {formatTime(totalDuration)}</span>
          )}
        </div>

        {set.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-600 text-xs">
            Add songs from your library to build a set
          </div>
        )}

        <div className="divide-y divide-gray-800/50">
          {set.map((slot, i) => (
            <div key={slot.song.id} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-gray-500 font-mono w-5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{slot.song.song.title}</div>
                  <div className="text-xs text-gray-500">{slot.song.song.bpm} BPM · {slot.song.song.key}</div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => moveSlot(i, -1)} disabled={i === 0} className="w-6 h-6 flex items-center justify-center rounded bg-gray-800 text-gray-400 disabled:opacity-30 text-xs hover:bg-gray-700">↑</button>
                  <button onClick={() => moveSlot(i, 1)} disabled={i === set.length - 1} className="w-6 h-6 flex items-center justify-center rounded bg-gray-800 text-gray-400 disabled:opacity-30 text-xs hover:bg-gray-700">↓</button>
                  <button onClick={() => removeFromSet(slot.song.id)} className="w-6 h-6 flex items-center justify-center rounded bg-gray-800 hover:bg-red-900 text-gray-400 hover:text-red-400 text-xs">×</button>
                </div>
              </div>

              {/* Transition type (between slots) */}
              {i < set.length - 1 && (
                <div className="flex items-center gap-2 pl-5">
                  <span className="text-xs text-gray-600">Transition →</span>
                  {(['cut', 'blend', 'beatmatch'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => updateTransition(slot.song.id, t)}
                      className={`text-xs px-2 py-0.5 rounded ${
                        slot.transitionType === t
                          ? 'bg-indigo-700 text-white'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
