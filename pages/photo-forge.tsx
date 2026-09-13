import { useState } from 'react'
import Link from 'next/link'
import HeidiChat from '../components/HeidiChat'

/**
 * Photo Forge dashboard -- see photo-forge-dashboard-spec.md for the design
 * spec this implements (phase 1: "Read-only integration": embed HeidiChat
 * calling the existing route as-is, confirm round-trip works).
 *
 * SCOPE: this is a UI scaffold, not a working photo-generation pipeline.
 * There is no image-generation/upload backend anywhere in this repo today
 * (verified before writing this file) -- PhotoForgeWorkspace below models
 * the intended layout (upload / generate / edit / gallery) with local,
 * in-memory placeholder state so the two-pane layout and the chat embed can
 * be verified end-to-end. Wiring real upload/generation endpoints is a
 * separate, larger piece of work once that backend exists.
 *
 * The chat pane on the right is fully real: it's the same HeidiChat
 * component embedding the same verified /api/chat contract used by the
 * main dashboard (pages/index.tsx), not a mock.
 */

type GalleryItem = { id: string; label: string; createdAt: Date }

function PhotoForgeWorkspace() {
  const [prompt, setPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [gallery, setGallery] = useState<GalleryItem[]>([])

  // PLACEHOLDER: no image-generation backend exists yet. This simulates the
  // interaction (loading state -> a new gallery entry) so the layout and
  // flow can be reviewed before a real endpoint is wired in.
  const handleGenerate = () => {
    if (!prompt.trim() || isGenerating) return
    setIsGenerating(true)
    setTimeout(() => {
      setGallery(prev => [{ id: `g-${Date.now()}`, label: prompt.trim(), createdAt: new Date() }, ...prev])
      setIsGenerating(false)
      setPrompt('')
    }, 600)
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="max-w-3xl">
        <h1 className="text-lg font-semibold text-gray-100">Photo Forge</h1>
        <p className="text-sm text-gray-500 mt-1">
          Generate, edit, and manage image outputs. Ask Heidi on the right for help while you work.
        </p>

        {/* Upload */}
        <div className="mt-6 border border-dashed border-white/[0.12] rounded-2xl p-6 text-center">
          <p className="text-sm text-gray-400">Drag an image here, or click to upload</p>
          <p className="text-[11px] text-gray-600 mt-1">Upload is not yet wired to a backend -- UI placeholder only</p>
          <button
            type="button"
            disabled
            className="mt-3 px-3 py-1.5 text-xs text-gray-500 bg-white/[0.03] border border-white/[0.06] rounded-lg cursor-not-allowed"
          >
            Choose file
          </button>
        </div>

        {/* Generate */}
        <div className="mt-6">
          <label className="text-xs font-medium text-gray-400">Generate</label>
          <div className="mt-2 flex gap-2">
            <input
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleGenerate()}
              placeholder="Describe the image you want..."
              className="flex-1 bg-white/[0.04] border border-white/[0.08] focus:border-violet-500/40 rounded-xl px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none transition-colors"
            />
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || isGenerating}
              className="px-4 py-2 text-xs font-medium rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-30 disabled:hover:bg-violet-600 transition-colors shrink-0"
            >
              {isGenerating ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </div>

        {/* Gallery */}
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-gray-400">Gallery</label>
            <span className="text-[11px] text-gray-600">{gallery.length} output{gallery.length === 1 ? '' : 's'}</span>
          </div>

          {gallery.length === 0 ? (
            <div className="mt-3 text-sm text-gray-600 border border-white/[0.06] rounded-xl px-4 py-8 text-center">
              No outputs yet. Generated images will appear here.
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {gallery.map(item => (
                <div
                  key={item.id}
                  className="aspect-square rounded-xl bg-white/[0.04] border border-white/[0.06] flex flex-col items-center justify-center p-3 text-center"
                >
                  <span className="text-[11px] text-gray-400 line-clamp-3">{item.label}</span>
                  <span className="text-[10px] text-gray-700 mt-2">{item.createdAt.toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Module switcher, matching the tab-bar visual pattern already established
// in pages/ops.tsx -- these are separate routes (not tabs within one page),
// so real next/link navigation rather than local tab state.
function ModuleSwitcher() {
  const modules: [string, string][] = [
    ['/', 'Heidi'],
    ['/photo-forge', 'Photo Forge'],
    ['/ops', 'Operations'],
    ['/agent-manager', 'Agents'],
  ]

  return (
    <nav className="flex gap-1 px-5 py-2 border-b border-white/[0.06] bg-[#0f0f17]/60 shrink-0">
      {modules.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
            href === '/photo-forge'
              ? 'bg-violet-600/20 text-violet-300 border border-violet-500/20'
              : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.04] border border-transparent'
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}

export default function PhotoForgeDashboard() {
  const [chatOpen, setChatOpen] = useState(true)

  return (
    <div className="flex flex-col h-[100dvh] bg-[#0f0f17] text-gray-100">
      <ModuleSwitcher />

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0">
          <PhotoForgeWorkspace />
        </div>

        {chatOpen ? (
          <div className="w-[360px] shrink-0 border-l border-white/[0.06] relative">
            <button
              onClick={() => setChatOpen(false)}
              className="absolute -left-3 top-3 w-6 h-6 rounded-full bg-[#16161f] border border-white/[0.08] text-gray-500 hover:text-gray-300 text-xs flex items-center justify-center z-10"
              title="Collapse chat"
              aria-label="Collapse chat"
            >
              &rsaquo;
            </button>
            <HeidiChat subtitle="Photo Forge" suggestions={['Suggest an edit', 'What can you do here?', 'System status']} />
          </div>
        ) : (
          <button
            onClick={() => setChatOpen(true)}
            className="shrink-0 w-8 border-l border-white/[0.06] hover:bg-white/[0.03] flex items-center justify-center text-gray-500 hover:text-gray-300 text-xs"
            title="Expand chat"
            aria-label="Expand chat"
          >
            &lsaquo;
          </button>
        )}
      </div>
    </div>
  )
}
