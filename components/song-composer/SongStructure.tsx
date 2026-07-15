import React, { useState } from 'react';

interface Section {
  id: string;
  name: string;
  bars: number;
  start_bar: number;
  chords: string[];
  melody_notes?: string[];
  instruments: string[];
  description: string;
  color: string;
}

interface LyricLine {
  bar: number;
  section: string;
  text: string;
}

interface Song {
  title: string;
  bpm: number;
  key: string;
  time_signature: string;
  genre: string;
  mood: string;
  total_bars: number;
  sections: Section[];
  lyrics: LyricLine[];
  production_notes: string;
}

interface Props {
  song: Song;
  currentBar: number;
  onSectionJump: (bar: number) => void;
}

const NOTE_COLORS: Record<string, string> = {
  C: 'bg-red-500', D: 'bg-orange-500', E: 'bg-yellow-500', F: 'bg-green-500',
  G: 'bg-teal-500', A: 'bg-blue-500', B: 'bg-purple-500',
};

function ChordPill({ chord }: { chord: string }) {
  const root = chord.match(/^[A-G]/)?.[0] || 'C';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono text-white ${NOTE_COLORS[root] || 'bg-gray-600'}`}>
      {chord}
    </span>
  );
}

function NotePill({ note }: { note: string }) {
  const root = note.match(/^[A-G]/)?.[0] || 'C';
  return (
    <span className={`inline-block w-7 h-7 rounded-full text-xs font-bold text-white flex items-center justify-center ${NOTE_COLORS[root] || 'bg-gray-600'}`}>
      {note.replace(/[0-9]/, '')}
    </span>
  );
}

export default function SongStructure({ song, currentBar, onSectionJump }: Props) {
  const [expanded, setExpanded] = useState<string | null>(song.sections[0]?.id || null);
  const [showNotes, setShowNotes] = useState(false);

  const activeSection = song.sections.find(
    (s) => currentBar >= s.start_bar && currentBar < s.start_bar + s.bars
  );

  const lyricsForSection = (sectionId: string) =>
    song.lyrics.filter((l) => l.section === sectionId);

  return (
    <div className="bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div>
          <h3 className="font-bold text-white text-sm">{song.title}</h3>
          <div className="flex gap-3 text-xs text-gray-400 mt-0.5">
            <span>{song.bpm} BPM</span>
            <span>{song.key}</span>
            <span>{song.time_signature}</span>
            <span className="capitalize">{song.genre}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNotes((v) => !v)}
            className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
          >
            {showNotes ? 'Hide notes' : 'Production notes'}
          </button>
        </div>
      </div>

      {showNotes && (
        <div className="px-4 py-3 bg-indigo-950/40 border-b border-gray-800 text-xs text-indigo-200">
          {song.production_notes}
        </div>
      )}

      {/* Section list */}
      <div className="divide-y divide-gray-800/50">
        {song.sections.map((sec) => {
          const isActive = activeSection?.id === sec.id;
          const isExpanded = expanded === sec.id;
          const lyrics = lyricsForSection(sec.id);

          return (
            <div key={sec.id} className={`${isActive ? 'bg-gray-900/60' : ''}`}>
              {/* Header row */}
              <button
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-900/40 transition-colors"
                onClick={() => setExpanded(isExpanded ? null : sec.id)}
              >
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: sec.color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{sec.name}</span>
                    {isActive && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-600 text-white">Now</span>
                    )}
                    <span className="text-xs text-gray-500">{sec.bars} bars</span>
                  </div>
                  <div className="flex gap-1.5 mt-1 flex-wrap">
                    {sec.chords.slice(0, 4).map((c, i) => (
                      <ChordPill key={i} chord={c} />
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); onSectionJump(sec.start_bar); }}
                    className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
                  >
                    ▶ Jump
                  </button>
                  <span className="text-gray-600 text-xs">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-gray-800/50">
                  {/* Description */}
                  <p className="text-xs text-gray-400 pt-2">{sec.description}</p>

                  {/* Instruments */}
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5">Instruments</p>
                    <div className="flex flex-wrap gap-1.5">
                      {sec.instruments.map((inst, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 bg-gray-800 text-gray-300 rounded">
                          {inst}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Melody notes */}
                  {sec.melody_notes && sec.melody_notes.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5">Melody notes</p>
                      <div className="flex gap-2">
                        {sec.melody_notes.map((n, i) => (
                          <NotePill key={i} note={n} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Full chord progression */}
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5">Full chord progression</p>
                    <div className="flex flex-wrap gap-1.5">
                      {sec.chords.map((c, i) => (
                        <ChordPill key={i} chord={c} />
                      ))}
                    </div>
                  </div>

                  {/* Lyrics */}
                  {lyrics.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5">Lyrics</p>
                      <div className="space-y-1">
                        {lyrics.map((l, i) => (
                          <div key={i} className="flex gap-2 text-xs">
                            <span className="text-gray-600 font-mono w-10 flex-shrink-0">b{l.bar}</span>
                            <span className="text-gray-300 italic">&quot;{l.text}&quot;</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
