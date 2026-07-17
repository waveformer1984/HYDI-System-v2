// Stream Health Watchdog — alerts via Resend when any revenue stream goes 24h silent.
// Invoke on a schedule (pg_cron) or manually via POST.
// JWT: false (internal only — restrict via HYDI_WATCHDOG_KEY header).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { rateLimit } from '../_shared/security.ts';

const STREAMS = [
  'galactic_bytes',
  'detailer_bot',
  'lipi_v2',
  'protogrance_aromatics',
  'rezonate',
  'waveformer_studio',
];
const SILENCE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-watchdog-key',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Fail closed: if HYDI_WATCHDOG_KEY isn't configured, reject every
  // request instead of skipping the check entirely (previously fell open
  // -- see ISSUES_FOUND.md, same class of bug already fixed for
  // keeper-break-glass).
  const watchdogKey = Deno.env.get('HYDI_WATCHDOG_KEY');
  if (!watchdogKey) {
    console.error('HYDI_WATCHDOG_KEY is not configured -- rejecting all watchdog requests');
    return new Response(JSON.stringify({ error: 'Watchdog is not configured' }), {
      status: 503,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
  const provided = req.headers.get('x-watchdog-key');
  if (provided !== watchdogKey) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const limited = rateLimit(req, { name: 'stream-health-watchdog', windowMs: 60_000, max: 10 });
  if (limited) return limited;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const alertEmail = Deno.env.get('ALERT_EMAIL') ?? 'waveformer1984@gmail.com';
  const checkedAt = new Date().toISOString();

  try {
    const cutoff = new Date(Date.now() - SILENCE_THRESHOLD_MS).toISOString();

    // Which streams have had ledger activity in the last 24h?
    const { data: recent, error: ledgerErr } = await supabase
      .from('ledger')
      .select('revenue_stream, created_at')
      .in('revenue_stream', STREAMS)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false });

    if (ledgerErr) throw ledgerErr;

    const activeStreams = new Set((recent ?? []).map((r) => r.revenue_stream));
    const silentStreams = STREAMS.filter((s) => !activeStreams.has(s));

    if (silentStreams.length === 0) {
      return new Response(
        JSON.stringify({ status: 'ok', message: 'All streams active', checked_at: checkedAt }),
        { headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // Fire alert email
    let alerted = false;
    if (resendKey) {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'HYDI Watchdog <alerts@hydi.system>',
          to: alertEmail,
          subject: `[HYDI] ${silentStreams.length} revenue stream(s) silent >24h`,
          html: `
            <h2 style="color:#c0392b">HYDI Revenue Stream Alert</h2>
            <p>The following streams have had <strong>no ledger activity in the last 24 hours</strong>:</p>
            <ul>${silentStreams.map((s) => `<li><code>${s}</code></li>`).join('')}</ul>
            <p>Check Stripe Connect dashboard and verify webhook delivery for these accounts.</p>
            <hr/>
            <p style="color:#666;font-size:12px">${checkedAt} · HYDI Stream Health Watchdog</p>
          `,
        }),
      });
      alerted = emailRes.ok;
      if (!emailRes.ok) console.error('[watchdog] Resend error:', await emailRes.text());
    }

    // Audit trail in keymaker_events
    await supabase.from('keymaker_events').insert({
      event_type: 'stream_health_alert',
      severity: silentStreams.length >= 3 ? 'high' : 'medium',
      payload: { silent_streams: silentStreams, alerted, checked_at: checkedAt },
    });

    return new Response(
      JSON.stringify({
        status: 'alert',
        silent_streams: silentStreams,
        alerted,
        checked_at: checkedAt,
      }),
      {
        status: 207,
        headers: { ...cors, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[watchdog] error:', msg);
    return new Response(
      JSON.stringify({ status: 'error', error: msg, checked_at: checkedAt }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});
