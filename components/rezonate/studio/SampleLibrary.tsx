'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAudioEngine } from '../../../providers/rezonate/AudioEngineProvider';

interface LibrarySample {
  id: string;
  name: string;
  category: string;
  tags: string[];
  audio_url: string;
  duration_ms: number | null;
  bpm: number | null;
  key: string | null;
  is_user_sample: boolean;
}

const CATEGORIES = ['all','drum','melody','bass','vocal','fx','loop','full_track'];
const CATEGORY_COLORS: Record<string, string> = {
  drum: '#f59e0b', melody: '#8b5cf6', bass: '#10b981',
  vocal: '#ec4899', fx: '#06b6d4', loop: '#f97316', full_track: '#6366f1',
};

interface SampleLibraryProps {
  onLoadToPad?: (padIndex: number, buffer: AudioBuffer, name: string) => void;
}

export function SampleLibrary({ onLoadToPad }: SampleLibraryProps) {
  const { engine, samples } = useAudioEngine();
  const [category, setCategory] = useState('all');
  const [items, setItems] = useState<LibrarySample[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [targetPad, setTargetPad] = useState(0);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const previewSrcRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '40' });
    if (category !== 'all') params.set('category', category);
    fetch(`/api/rezonate/library?${params}`)
      .then(r => r.json())
      .then(j => setItems(j.data ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [category]);

  const stopPreview = useCallback(() => {
    if (previewSrcRef.current) {
      try { previewSrcRef.current.stop(); } catch {}
      previewSrcRef.current = null;
    }
    setPreviewId(null);
  }, []);

  const handlePreview = useCallback(async (item: LibrarySample) => {
    stopPreview();
    if (previewId === item.id) return; // toggle off
    try {
      const blob = await fetch(item.audio_url).then(r => r.blob());
      await samples.loadBlob(`__preview__${item.id}`, blob);
      const src = samples.play(`__preview__${item.id}`);
      if (src) {
        previewSrcRef.current = src;
        src.onended = () => setPreviewId(null);
      }
      setPreviewId(item.id);
    } catch {}
  }, [previewId, samples, stopPreview]);

  const handleLoad = useCallback(async (item: LibrarySample) => {
    setLoadingId(item.id);
    try {
      const padId = `pad-${targetPad}`;
      const cacheKey = `__preview__${item.id}`;
      if (!samples.has(cacheKey)) {
        const blob = await fetch(item.audio_url).then(r => r.blob());
        await samples.loadBlob(cacheKey, blob);
      }
      const buf = samples.get(cacheKey)!;
      (samples as unknown as { _buffers: Map<string, AudioBuffer> })._buffers.set(padId, buf);
      onLoadToPad?.(targetPad, buf, item.name);
    } catch {}
    setLoadingId(null);
  }, [targetPad, samples, onLoadToPad]);

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm tracking-wide uppercase">Sample Library</h3>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-xs">→ Pad</span>
          <select value={targetPad} onChange={e => setTargetPad(Number(e.target.value))}
            className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-0.5 text-xs">
            {Array.from({ length: 8 }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}
          </select>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-1">
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => setCategory(c)}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors capitalize
              ${category === c ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
            {c}
          </button>
        ))}
      </div>

      {/* Items */}
      <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
        {loading && <p className="text-gray-500 text-xs text-center py-4">Loading…</p>}
        {!loading && items.length === 0 && (
          <p className="text-gray-500 text-xs text-center py-4">No samples in this category yet</p>
        )}
        {items.map(item => {
          const color = CATEGORY_COLORS[item.category] ?? '#8b5cf6';
          const isPreviewing = previewId === item.id;
          const isLoading = loadingId === item.id;
          return (
            <div key={item.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-800 group">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
              <span className="flex-1 text-white text-xs truncate">{item.name}</span>
              {item.bpm && <span className="text-gray-500 text-xs">{item.bpm}bpm</span>}
              {item.key && <span className="text-gray-500 text-xs">{item.key}</span>}
              <button onClick={() => handlePreview(item)}
                className={`px-2 py-0.5 rounded text-xs transition-colors
                  ${isPreviewing ? 'bg-violet-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
                {isPreviewing ? '■' : '▶'}
              </button>
              <button onClick={() => handleLoad(item)}
                disabled={isLoading}
                className="px-2 py-0.5 bg-emerald-800 hover:bg-emerald-700 disabled:opacity-40 text-white rounded text-xs transition-colors">
                {isLoading ? '…' : 'Load'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
