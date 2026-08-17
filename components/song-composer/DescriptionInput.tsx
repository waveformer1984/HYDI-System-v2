import React, { useState } from 'react';

const STYLE_PRESETS = [
  'lo-fi hip hop', 'indie rock', 'R&B soul', 'electronic ambient',
  'jazz fusion', 'folk acoustic', 'trap', 'cinematic orchestral',
];

const EXAMPLE_PROMPTS = [
  'A melancholic late-night drive song, minor key, slow tempo, heavy reverb guitar over soft 808s',
  'Uplifting summer anthem with layered vocals, punchy drums, and a hook that sticks',
  'Dark introspective trap ballad — vulnerable verses, explosive chorus drop',
  'Jazzy lo-fi study beat with vinyl crackle, muted trumpet samples, and lazy drums',
];

interface Props {
  onGenerate: (_description: string, _style: string) => void;
  loading: boolean;
}

export default function DescriptionInput({ onGenerate, loading }: Props) {
  const [description, setDescription] = useState('');
  const [style, setStyle] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (description.trim()) onGenerate(description.trim(), style);
  };

  return (
    <div className="bg-gradient-to-br from-indigo-950 to-purple-950 rounded-xl p-6 border border-indigo-800">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-white">Tell Hydi Your Song Idea</h2>
        <p className="text-indigo-300 text-sm mt-1">
          Describe the vibe, emotion, genre, or story. Hydi will generate the full structure.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. A bittersweet song about leaving home — fingerpicked guitar intro, builds to a full band chorus with layered harmonies..."
          rows={3}
          className="w-full bg-indigo-900/50 border border-indigo-700 text-white placeholder-indigo-400 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />

        {/* Style chips */}
        <div>
          <p className="text-xs text-indigo-400 mb-2">Quick style (optional)</p>
          <div className="flex flex-wrap gap-2">
            {STYLE_PRESETS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStyle(style === s ? '' : s)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  style === s
                    ? 'bg-indigo-500 text-white border-indigo-500'
                    : 'bg-transparent text-indigo-300 border-indigo-700 hover:border-indigo-400'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Example prompts */}
        <div>
          <p className="text-xs text-indigo-400 mb-2">Try an example</p>
          <div className="space-y-1">
            {EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setDescription(ex)}
                className="block w-full text-left text-xs text-indigo-300 hover:text-white bg-indigo-900/30 hover:bg-indigo-900/60 px-3 py-2 rounded-lg transition-colors truncate"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={!description.trim() || loading}
          className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold rounded-lg hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Hydi is composing…
            </span>
          ) : (
            'Generate Song Structure'
          )}
        </button>
      </form>
    </div>
  );
}
