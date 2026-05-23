import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sendDeliveryEmail(
  to: string,
  beatName: string,
  downloadUrl: string,
  licenseType: string,
) {
  const sendGridKey = Deno.env.get('SENDGRID_API_KEY')
  const fromEmail = Deno.env.get('FROM_EMAIL') ?? 'noreply@rezonate.app'

  if (!sendGridKey) {
    console.warn('[REZONATE-DELIVERY] SENDGRID_API_KEY not set — simulating send')
    return { success: true, simulated: true }
  }

  const licenseLabel = licenseType === 'exclusive' ? 'Exclusive License' : 'Non-Exclusive License'
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:#7c3aed">Your beat is ready</h2>
      <p>Thanks for purchasing <strong>${beatName}</strong> on Rezonate.</p>
      <p style="margin:24px 0">
        <a href="${downloadUrl}"
           style="background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
          Download WAV
        </a>
      </p>
      <p style="color:#6b7280;font-size:13px">
        License: ${licenseLabel}<br>
        This link expires in 7 days. Download and keep your file safe.
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
      <p style="color:#9ca3af;font-size:12px">Rezonate — create, sell, own your sound.</p>
    </div>
  `

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sendGridKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromEmail, name: 'Rezonate' },
      subject: `Download your beat: ${beatName}`,
      content: [{ type: 'text/html', value: html }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`SendGrid error: ${err}`)
  }
  return { success: true }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (req.method === 'GET') {
    return jsonResponse({ status: 'active', service: 'rezonate-delivery' })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  let body: { stripe_session_id?: string; project_id: string; buyer_email: string; license_type?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const { stripe_session_id, project_id, buyer_email, license_type = 'non_exclusive' } = body
  if (!project_id || !buyer_email) {
    return jsonResponse({ error: 'project_id and buyer_email required' }, 400)
  }

  // 1. Fetch project
  const { data: project, error: projErr } = await supabase
    .from('rezonate_projects')
    .select('name, audio_export_url, public_slug, price_cents')
    .eq('id', project_id)
    .single()

  if (projErr || !project) {
    return jsonResponse({ error: 'Project not found' }, 404)
  }

  if (!project.audio_export_url) {
    console.warn(`[REZONATE-DELIVERY] project ${project_id} has no audio_export_url — cannot deliver`)
    return jsonResponse({ error: 'No audio file available for this project', project_id }, 422)
  }

  // 2. Create signed Storage URL (7 days)
  // audio_export_url is stored as the Storage path: "rezonate-beats/{project_id}/beat.wav"
  const storagePath = project.audio_export_url.startsWith('rezonate-beats/')
    ? project.audio_export_url
    : project.audio_export_url // fallback: use as-is if it's already a full URL

  let downloadUrl: string
  if (storagePath.startsWith('http')) {
    // Already a full URL — use directly (public bucket or pre-signed)
    downloadUrl = storagePath
  } else {
    const { data: signed, error: signErr } = await supabase.storage
      .from('rezonate-beats')
      .createSignedUrl(storagePath.replace('rezonate-beats/', ''), 60 * 60 * 24 * 7)
    if (signErr || !signed?.signedUrl) {
      console.error('[REZONATE-DELIVERY] Storage sign error:', signErr?.message)
      return jsonResponse({ error: 'Could not generate download link' }, 500)
    }
    downloadUrl = signed.signedUrl
  }

  // 3. Send email
  try {
    await sendDeliveryEmail(buyer_email, project.name, downloadUrl, license_type)
  } catch (emailErr) {
    console.error('[REZONATE-DELIVERY] Email error:', (emailErr as Error).message)
    // Non-fatal: log but continue to record delivery
  }

  // 4. Record delivery
  await supabase.from('rezonate_deliveries').insert({
    project_id,
    buyer_email,
    download_url: downloadUrl,
    stripe_session_id: stripe_session_id ?? null,
  })

  // 5. Mark ledger entry as completed
  if (stripe_session_id) {
    await supabase
      .from('ledger')
      .update({ status: 'completed' })
      .contains('metadata', { stripe_session_id })
  }

  console.info(`[REZONATE-DELIVERY] Delivered ${project.name} to ${buyer_email}`)
  return jsonResponse({ delivered: true, project_id, buyer_email })
})
