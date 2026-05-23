/**
 * pages/rezonate/beatbox.tsx
 *
 * Beat Box capture page — dynamically loads BeatBoxCapture (browser-only, Web Audio API)
 * and handles save by converting each pad's Blob to base64 and POSTing to
 * /api/rezonate/capture.
 *
 * Uses Next.js pages router with dynamic() + { ssr: false } so the Web Audio
 * API is never instantiated during server-side rendering.
 */

import { useState, useCallback } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'

// ── Dynamic import — Web Audio API is browser-only. ────────────────────────
const BeatBoxCapture = dynamic(
  () => import('../../components/rezonate/BeatBoxCapture'),
  { ssr: false }
)

// ── Toast state type ────────────────────────────────────────────────────────
type ToastState = {
  message: string
  type: 'success' | 'error'
} | null

// ── Pad type mirroring what BeatBoxCapture session emits ───────────────────
interface PadRecord {
  padIndex: number
  label: string
  durationMs: number
  mimeType: string
  audioBlob: Blob
}

interface BeatBoxSession {
  projectId?: string
  pads: PadRecord[]
  capturedAt: string
}

/**
 * Converts a Blob to a base64-encoded string without relying on btoa's
 * character-limit issues on large buffers — uses the typed-array spread
 * approach for correct binary-safe encoding.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  // Process in chunks to avoid call-stack limits on large audio files.
  let binary = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export default function BeatBoxPage() {
  const router = useRouter()
  const { projectId: queryProjectId } = router.query

  // projectId may be undefined until router is ready; treat as string | undefined.
  const projectId = typeof queryProjectId === 'string' ? queryProjectId : undefined

  const [toast, setToast] = useState<ToastState>(null)
  const [saving, setSaving] = useState(false)

  /** Show a transient toast for 3 seconds. */
  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  /**
   * Called by BeatBoxCapture when the user triggers a save action.
   * Converts each pad's Blob to base64, then POSTs to /api/rezonate/capture.
   */
  const handleSave = useCallback(async (session: BeatBoxSession) => {
    setSaving(true)
    try {
      // Convert each pad's audioBlob to base64 — audio data is NOT sent to DB,
      // but the API acknowledges receipt for client-side workflows.
      const padsData = await Promise.all(
        session.pads.map(async (pad) => {
          const arrayBuffer = await pad.audioBlob.arrayBuffer()
          const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
          return {
            padIndex: pad.padIndex,
            label: pad.label,
            durationMs: pad.durationMs,
            mimeType: pad.mimeType,
            audioBase64: base64,
          }
        })
      )

      const res = await fetch('/api/rezonate/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: session.projectId ?? projectId,
          pads: padsData,
          capturedAt: session.capturedAt,
        }),
      })

      if (!res.ok) throw new Error('Save failed')

      showToast('Session saved!', 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed'
      showToast(message, 'error')
      // Re-throw so BeatBoxCapture can handle its own error state if needed.
      throw err
    } finally {
      setSaving(false)
    }
  }, [projectId, showToast])

  return (
    <>
      <Head>
        <title>Beat Box — Rezonate</title>
      </Head>

      {/* Full dark layout matching the app style */}
      <div className="min-h-screen bg-gray-900 text-white">

        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <Link
            href="/rezonate"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            ← Rezonate
          </Link>

          <h1 className="text-lg font-semibold tracking-wide text-white">
            Beat Box
          </h1>

          {/* Spacer to keep title centred */}
          <div className="w-20" />
        </div>

        {/* Main content */}
        <main className="px-6 py-8">
          {/* BeatBoxCapture is loaded client-side only (Web Audio API). */}
          <BeatBoxCapture
            projectId={projectId}
            onSave={handleSave}
          />
        </main>

        {/* Toast notification — success or error */}
        {toast && (
          <div
            role="alert"
            className={[
              'fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-lg',
              'text-sm font-medium shadow-lg transition-all',
              toast.type === 'success'
                ? 'bg-green-700 text-green-100'
                : 'bg-red-800 text-red-100',
            ].join(' ')}
          >
            {toast.message}
          </div>
        )}

        {/* Saving overlay — prevents double-submit */}
        {saving && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg px-8 py-5 text-sm text-gray-300">
              Saving session…
            </div>
          </div>
        )}
      </div>
    </>
  )
}
