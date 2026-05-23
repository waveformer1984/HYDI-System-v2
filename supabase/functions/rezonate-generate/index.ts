/**
 * rezonate-generate — Deno Edge Function
 *
 * Routes AI music generation requests to real provider APIs:
 *   - google_lyria  : Google Lyria via Gemini API (melody, full tracks, ambient)
 *   - replicate_musicgen : Meta MusicGen via Replicate (drums, bass, melody)
 *   - elevenlabs    : ElevenLabs Sound Generation (drums, fx, one-shots)
 *
 * Returns { audio_url?, audio_base64?, content_type, provider, duration_s }
 * Caller fetches the URL or decodes base64 → Blob → AudioBuffer.
 *
 * JWT: disabled — called from browser with service-role header or from
 * other edge functions.
 *
 * Required environment variables:
 *   GOOGLE_AI_API_KEY    — Gemini/Lyria API key from Google AI Studio
 *   REPLICATE_API_TOKEN  — Replicate API token
 *   ELEVENLABS_API_KEY   — ElevenLabs API key
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ── Types ────────────────────────────────────────────────────────────────────

type Provider = 'google_lyria' | 'replicate_musicgen' | 'elevenlabs'

interface GenerateRequest {
  provider: Provider
  prompt: string
  duration?: number   // seconds, default 8
  bpm?: number
  key?: string
  style?: string
  type?: 'drum' | 'melody' | 'vocal' | 'fx' | 'full_track'
  // MusicGen-specific
  musicgen_model?: 'stereo-melody-large' | 'melody-large' | 'large' | 'medium'
  // Lyria-specific
  lyria_temperature?: number
}

interface GenerateResult {
  audio_url?: string
  audio_base64?: string
  content_type: string
  provider: Provider
  duration_s: number
  prompt_used: string
}

// ── Google Lyria ─────────────────────────────────────────────────────────────

async function generateWithLyria(req: GenerateRequest): Promise<GenerateResult> {
  const apiKey = Deno.env.get('GOOGLE_AI_API_KEY')
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not configured')

  const duration = req.duration ?? 8
  const prompt = buildLyriaPrompt(req)

  // Lyria is accessed via the Gemini API music generation endpoint
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/lyria-realtime-exp:predict?key=${apiKey}`

  const body = {
    instances: [{
      prompt,
      duration_seconds: duration,
      sample_rate: 44100,
    }],
    parameters: {
      temperature: req.lyria_temperature ?? 1.0,
    },
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    // If this specific endpoint isn't available, try the Vertex AI path
    throw new Error(`Lyria API error ${res.status}: ${err}`)
  }

  const data = await res.json()
  // Lyria returns base64-encoded audio in predictions[0].audio
  const audio_base64: string = data.predictions?.[0]?.audio ?? data.predictions?.[0]?.bytesBase64Encoded
  if (!audio_base64) throw new Error('Lyria returned no audio data')

  return {
    audio_base64,
    content_type: 'audio/wav',
    provider: 'google_lyria',
    duration_s: duration,
    prompt_used: prompt,
  }
}

function buildLyriaPrompt(req: GenerateRequest): string {
  const parts: string[] = [req.prompt]
  if (req.bpm) parts.push(`${req.bpm} BPM`)
  if (req.key) parts.push(`in ${req.key}`)
  if (req.style) parts.push(req.style)
  if (req.type === 'drum') parts.push('drums and percussion only, no melody')
  if (req.type === 'melody') parts.push('melodic instrument, no drums')
  if (req.type === 'vocal') parts.push('vocal melody, wordless, no instruments')
  if (req.type === 'full_track') parts.push('full arrangement with drums, bass, and melody')
  return parts.join(', ')
}

// ── Replicate MusicGen ───────────────────────────────────────────────────────

async function generateWithMusicGen(req: GenerateRequest): Promise<GenerateResult> {
  const token = Deno.env.get('REPLICATE_API_TOKEN')
  if (!token) throw new Error('REPLICATE_API_TOKEN not configured')

  const duration = req.duration ?? 8
  const model = req.musicgen_model ?? 'stereo-melody-large'
  const prompt = buildMusicGenPrompt(req)

  // Create prediction
  const createRes = await fetch('https://api.replicate.com/v1/models/meta/musicgen/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'wait', // wait up to 60s for result inline
    },
    body: JSON.stringify({
      input: {
        prompt,
        model_version: model,
        duration,
        output_format: 'mp3',
        normalization_strategy: 'peak',
        top_k: 250,
        top_p: 0,
        temperature: 1.0,
      },
    }),
  })

  if (!createRes.ok) {
    const err = await createRes.text()
    throw new Error(`Replicate create error ${createRes.status}: ${err}`)
  }

  let prediction = await createRes.json()

  // Poll if not immediately completed (Prefer: wait may time out)
  if (prediction.status !== 'succeeded') {
    const pollUrl = prediction.urls?.get ?? `https://api.replicate.com/v1/predictions/${prediction.id}`
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const pollRes = await fetch(pollUrl, {
        headers: { Authorization: `Token ${token}` },
      })
      prediction = await pollRes.json()
      if (prediction.status === 'succeeded') break
      if (prediction.status === 'failed') throw new Error(`MusicGen failed: ${prediction.error}`)
    }
  }

  if (prediction.status !== 'succeeded') throw new Error('MusicGen timed out')

  const audio_url: string = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output
  if (!audio_url) throw new Error('MusicGen returned no output URL')

  return {
    audio_url,
    content_type: 'audio/mpeg',
    provider: 'replicate_musicgen',
    duration_s: duration,
    prompt_used: prompt,
  }
}

function buildMusicGenPrompt(req: GenerateRequest): string {
  const parts: string[] = []
  if (req.style) parts.push(req.style)
  parts.push(req.prompt)
  if (req.bpm) parts.push(`${req.bpm} bpm`)
  if (req.key) parts.push(req.key)
  if (req.type === 'drum') parts.push('drums and percussion, no melody, no bass')
  if (req.type === 'melody') parts.push('melodic, no drums')
  if (req.type === 'full_track') parts.push('full song arrangement')
  return parts.filter(Boolean).join(', ')
}

// ── ElevenLabs Sound Generation ───────────────────────────────────────────────

async function generateWithElevenLabs(req: GenerateRequest): Promise<GenerateResult> {
  const apiKey = Deno.env.get('ELEVENLABS_API_KEY')
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not configured')

  const duration = Math.min(req.duration ?? 2, 22) // ElevenLabs max ~22s
  const prompt = buildElevenLabsPrompt(req)

  const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: prompt,
      duration_seconds: duration,
      prompt_influence: 0.3,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`ElevenLabs error ${res.status}: ${err}`)
  }

  // Returns raw audio bytes (mp3)
  const audioBytes = await res.arrayBuffer()
  const audio_base64 = btoa(String.fromCharCode(...new Uint8Array(audioBytes)))

  return {
    audio_base64,
    content_type: 'audio/mpeg',
    provider: 'elevenlabs',
    duration_s: duration,
    prompt_used: prompt,
  }
}

function buildElevenLabsPrompt(req: GenerateRequest): string {
  const parts: string[] = [req.prompt]
  if (req.type === 'drum') parts.push('percussion hit, rhythmic, punchy')
  if (req.type === 'fx') parts.push('sound effect, atmospheric')
  if (req.type === 'vocal') parts.push('vocal tone, melodic')
  if (req.style) parts.push(req.style)
  return parts.join(', ')
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (req.method === 'GET') {
    return json({
      status: 'active',
      service: 'rezonate-generate',
      providers: ['google_lyria', 'replicate_musicgen', 'elevenlabs'],
      env_required: {
        google_lyria: 'GOOGLE_AI_API_KEY',
        replicate_musicgen: 'REPLICATE_API_TOKEN',
        elevenlabs: 'ELEVENLABS_API_KEY',
      },
    })
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: GenerateRequest
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const { provider, prompt } = body
  if (!provider || !prompt) return json({ error: 'provider and prompt required' }, 400)

  const VALID_PROVIDERS: Provider[] = ['google_lyria', 'replicate_musicgen', 'elevenlabs']
  if (!VALID_PROVIDERS.includes(provider)) {
    return json({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` }, 400)
  }

  console.info(`[REZONATE-GENERATE] ${provider} | prompt: ${prompt.slice(0, 80)}`)

  try {
    let result: GenerateResult
    switch (provider) {
      case 'google_lyria':
        result = await generateWithLyria(body)
        break
      case 'replicate_musicgen':
        result = await generateWithMusicGen(body)
        break
      case 'elevenlabs':
        result = await generateWithElevenLabs(body)
        break
    }
    return json({ result })
  } catch (err) {
    const msg = (err as Error).message
    console.error(`[REZONATE-GENERATE] ${provider} error:`, msg)
    return json({ error: msg, provider }, 500)
  }
})
