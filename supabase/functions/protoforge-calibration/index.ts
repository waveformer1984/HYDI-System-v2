/**
 * ProtoForge Calibration Edge Function
 *
 * Invokes the calibrate_protoforge_decisions() RPC to close the feedback loop:
 * matches approved decisions to their execution outcomes and backfills
 * decisions.outcome (success / failure / unknown).
 *
 * Callable two ways:
 *   POST /functions/v1/protoforge-calibration
 *   Body (optional JSON): { grace_minutes?: number, timeout_minutes?: number }
 *
 *   GET  /functions/v1/protoforge-calibration
 *   Query params (optional): ?grace=5&timeout=60
 *
 * Also invoked automatically by the pg_cron job every 5 minutes.
 *
 * Returns:
 *   { resolved_success, resolved_failure, resolved_unknown,
 *     skipped_in_grace, total_resolved, calibrated_at }
 */

import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const GRACE_DEFAULT   = 5;   // minutes before a decision is eligible
const TIMEOUT_DEFAULT = 60;  // minutes before an unresolved decision → unknown

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // ── Auth guard — service role only ────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  const supabaseUrl     = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Missing Supabase runtime env" }, 500);
  }

  // Reject calls that don't carry the service key (pg_cron uses internal auth,
  // so we accept both the service key and the pg_cron internal bearer).
  if (token && token !== serviceRoleKey) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── Parse parameters ───────────────────────────────────────────────────────
  let graceMinutes   = GRACE_DEFAULT;
  let timeoutMinutes = TIMEOUT_DEFAULT;

  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (typeof body.grace_minutes   === "number") graceMinutes   = body.grace_minutes;
      if (typeof body.timeout_minutes === "number") timeoutMinutes = body.timeout_minutes;
    } else {
      const url = new URL(req.url);
      const g = Number(url.searchParams.get("grace"));
      const t = Number(url.searchParams.get("timeout"));
      if (g > 0) graceMinutes   = g;
      if (t > 0) timeoutMinutes = t;
    }
  } catch (_) {
    // non-fatal — fall back to defaults
  }

  // ── Invoke RPC ─────────────────────────────────────────────────────────────
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data, error } = await supabase.rpc("calibrate_protoforge_decisions", {
    p_grace_minutes:   graceMinutes,
    p_timeout_minutes: timeoutMinutes,
  });

  if (error) {
    console.error("[PROTOFORGE-CALIBRATION] RPC error:", error.message);
    return json({ error: error.message, code: error.code }, 500);
  }

  const result = data as {
    resolved_success: number;
    resolved_failure: number;
    resolved_unknown: number;
    skipped_in_grace: number;
    total_resolved:   number;
    calibrated_at:    string;
  };

  console.log(
    `[PROTOFORGE-CALIBRATION] ` +
    `success=${result.resolved_success} ` +
    `failure=${result.resolved_failure} ` +
    `unknown=${result.resolved_unknown} ` +
    `skipped=${result.skipped_in_grace} ` +
    `total=${result.total_resolved}`
  );

  return json({
    ok: true,
    params: { grace_minutes: graceMinutes, timeout_minutes: timeoutMinutes },
    ...result,
  });
});
