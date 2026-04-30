import { createClient } from "npm:@supabase/supabase-js@2.49.8";
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
function backoffMinutes(retryCount) {
  const mins = Math.min(5 * 2 ** Math.max(0, retryCount), 24 * 60);
  return mins;
}
async function emitEvent(supabase, payload) {
  await supabase.from("event_bus_events").insert({
    event_type: "billing.updated",
    status: "pending",
    payload,
    retry_count: 0,
    max_retries: 3
  });
}
Deno.serve(async (req)=>{
  try {
    if (req.method !== "POST" && req.method !== "GET") {
      return json({
        error: "Method not allowed"
      }, 405);
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({
        error: "Missing Supabase runtime env"
      }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const url = new URL(req.url);
    const batchSizeRaw = url.searchParams.get("batch") ?? "20";
    const batchSize = Math.min(Math.max(Number(batchSizeRaw) || 20, 1), 100);
    const nowIso = new Date().toISOString();
    const { data: dueJobs, error: selectError } = await supabase.from("billing_jobs").select("id,idempotency_key,command,payload,owner_user_id,retry_count,max_retries").eq("status", "failed").lt("retry_count", 1000).lte("next_retry_at", nowIso).order("next_retry_at", {
      ascending: true
    }).limit(batchSize);
    if (selectError) {
      return json({
        error: "Failed to load due jobs",
        details: selectError.message
      }, 500);
    }
    const jobs = dueJobs ?? [];
    if (jobs.length === 0) {
      return json({
        ok: true,
        processed: 0,
        message: "No due retry jobs"
      });
    }
    const results = [];
    for (const job of jobs){
      // Claim job atomically-ish: only one worker can move failed -> processing
      const { data: claimed, error: claimError } = await supabase.from("billing_jobs").update({
        status: "processing",
        updated_at: new Date().toISOString()
      }).eq("id", job.id).eq("status", "failed").select("id").maybeSingle();
      if (claimError || !claimed) {
        results.push({
          job_id: job.id,
          skipped: true,
          reason: "claim_failed"
        });
        continue;
      }
      const stripeWorkerUrl = `${supabaseUrl}/functions/v1/stripe-worker`;
      const stripeRequest = {
        source: "billing-retry-worker",
        billing_job_id: job.id,
        command: job.command,
        payload: job.payload,
        idempotency_key: job.idempotency_key
      };
      const stripeResp = await fetch(stripeWorkerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
          "apikey": serviceRoleKey
        },
        body: JSON.stringify(stripeRequest)
      });
      const stripeText = await stripeResp.text();
      let stripeBody = stripeText;
      try {
        stripeBody = JSON.parse(stripeText);
      } catch  {
      // keep text
      }
      const attemptCount = (job.retry_count ?? 0) + 1;
      const maxRetries = job.max_retries ?? 3;
      const now = new Date().toISOString();
      if (stripeResp.ok) {
        await supabase.from("billing_jobs").update({
          status: "succeeded",
          stripe_request: stripeRequest,
          stripe_response: stripeBody,
          error: null,
          last_error_code: null,
          next_retry_at: null,
          retry_count: attemptCount,
          updated_at: now
        }).eq("id", job.id);
        await emitEvent(supabase, {
          billing_job_id: job.id,
          command: job.command,
          status: "succeeded",
          idempotency_key: job.idempotency_key,
          owner_user_id: job.owner_user_id,
          retry_count: attemptCount,
          max_retries: maxRetries,
          next_retry_at: null,
          at: now,
          source: "billing-retry-worker"
        });
        results.push({
          job_id: job.id,
          ok: true,
          status: "succeeded"
        });
        continue;
      }
      const canRetryAgain = attemptCount < maxRetries;
      const retryAt = canRetryAgain ? new Date(Date.now() + backoffMinutes(attemptCount - 1) * 60_000).toISOString() : null;
      await supabase.from("billing_jobs").update({
        status: "failed",
        retry_count: attemptCount,
        next_retry_at: retryAt,
        stripe_request: stripeRequest,
        stripe_response: stripeBody,
        error: `stripe-worker ${stripeResp.status}`,
        last_error_code: `stripe_${stripeResp.status}`,
        updated_at: now
      }).eq("id", job.id);
      await emitEvent(supabase, {
        billing_job_id: job.id,
        command: job.command,
        status: "failed",
        idempotency_key: job.idempotency_key,
        owner_user_id: job.owner_user_id,
        retry_count: attemptCount,
        max_retries: maxRetries,
        next_retry_at: retryAt,
        terminal: !canRetryAgain,
        at: now,
        source: "billing-retry-worker"
      });
      results.push({
        job_id: job.id,
        ok: false,
        status: "failed",
        retry_count: attemptCount,
        max_retries: maxRetries,
        next_retry_at: retryAt
      });
    }
    return json({
      ok: true,
      processed: results.length,
      results
    });
  } catch (err) {
    return json({
      error: "Unhandled retry worker error",
      details: String(err)
    }, 500);
  }
});
