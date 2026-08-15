import { useState, useCallback } from 'react';
import Link from 'next/link';
import HeidiChat from '../components/HeidiChat';
import { buildPhotoForgeMessage, PhotoForgeState } from '../lib/photo-forge-context';

const DEFAULT_STATE: PhotoForgeState = {
  image: 'portrait_001.png',
  tool: 'Crop',
  selection: '1024×768',
  lastAction: 'imported image',
};

export default function PhotoForgePage() {
  const [image, setImage] = useState(DEFAULT_STATE.image);
  const [tool, setTool] = useState(DEFAULT_STATE.tool);
  const [selection, setSelection] = useState(DEFAULT_STATE.selection);
  const [lastAction, setLastAction] = useState(DEFAULT_STATE.lastAction);
  const [gallery, setGallery] = useState<string[]>(['portrait_001.png']);

  const buildMessage = useCallback(
    (input: string) =>
      buildPhotoForgeMessage({ image: image || undefined, tool: tool || undefined, selection: selection || undefined, lastAction: lastAction || undefined }, input),
    [image, tool, selection, lastAction]
  );

  const applyAction = (action: string) => {
    setLastAction(action);
    setGallery(prev => [...prev, `${image} (${action})`]);
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-[#0f0f17] text-gray-100">
      <header className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-white/[0.06] bg-[#0f0f17]/90 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-sm font-bold">
            P
          </div>
          <h1 className="text-sm font-semibold tracking-tight">Photo Forge</h1>
        </div>
        <nav className="flex items-center gap-2 text-xs">
          <Link
            href="/"
            className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-gray-300 transition-colors"
          >
            Heidi Dashboard
          </Link>
          <Link
            href="/photo-forge"
            className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/20 text-emerald-300 transition-colors"
          >
            Photo Forge
          </Link>
        </nav>
      </header>

      <main className="flex-1 min-h-0 flex">
        <section className="w-[70%] min-w-0 flex flex-col border-r border-white/[0.06]">
          <div className="flex-1 min-h-0 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
                <h2 className="text-sm font-semibold mb-4">Workspace</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Current image</label>
                    <input
                      type="text"
                      value={image}
                      onChange={e => setImage(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-emerald-500/40"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Tool</label>
                    <select
                      value={tool}
                      onChange={e => setTool(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-emerald-500/40"
                    >
                      <option>Crop</option>
                      <option>Resize</option>
                      <option>Filter</option>
                      <option>Generate</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Selection</label>
                    <input
                      type="text"
                      value={selection}
                      onChange={e => setSelection(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-emerald-500/40"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Last action</label>
                    <input
                      type="text"
                      value={lastAction}
                      onChange={e => setLastAction(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-emerald-500/40"
                    />
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => applyAction('cropped')}
                    className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                  >
                    Apply Crop
                  </button>
                  <button
                    onClick={() => applyAction('resized')}
                    className="px-3 py-1.5 text-xs rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-gray-300 transition-colors"
                  >
                    Apply Resize
                  </button>
                  <button
                    onClick={() => applyAction('generated variant')}
                    className="px-3 py-1.5 text-xs rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-gray-300 transition-colors"
                  >
                    Generate
                  </button>
                </div>
              </div>

              <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
                <h2 className="text-sm font-semibold mb-3">Gallery</h2>
                {gallery.length === 0 ? (
                  <p className="text-xs text-gray-600">No images yet.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {gallery.map((item, i) => (
                      <div
                        key={`${item}-${i}`}
                        className="aspect-square rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-[10px] text-gray-500 text-center p-2"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="w-[30%] min-w-0 flex flex-col">
          <HeidiChat userId="photo-forge-user" buildMessage={buildMessage} className="h-full" />
        </section>
      </main>
    </div>
  );
}
