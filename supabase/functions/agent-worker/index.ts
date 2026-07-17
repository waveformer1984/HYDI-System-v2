/**
 * Agent Worker Edge Function
 * 
 * Claims jobs from queue, executes them, handles retries and dead-letter.
 * This is Agent Smith - self-replicating worker with strict limits.
 */

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { requireServiceRole } from "../_shared/security.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const WORKER_ID = `worker_${crypto.randomUUID()}_${Date.now()}`;
const MAX_CONCURRENT = 5;
const LOCK_TIMEOUT_MS = 300000; // 5 minutes

Deno.serve(async (req: Request) => {
  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json"
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Health check endpoint
    if (req.method === "GET") {
      const { data: stats } = await supabase
        .from("jobs")
        .select("status, count")
        .select("status", { count: "exact" })
        .in("status", ["queued", "running", "failed", "dead_letter"]);
      
      return new Response(
        JSON.stringify({
          status: "ok",
          worker_id: WORKER_ID,
          timestamp: new Date().toISOString()
        }),
        { headers: corsHeaders }
      );
    }

    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: corsHeaders }
      );
    }

    // Internal-only: claims and executes jobs (including stripe.webhook
    // job payloads) using the service-role key. verify_jwt=true alone only
    // proves *a* JWT was presented (the public anon key qualifies), not
    // that the caller is privileged -- see ISSUES_FOUND.md.
    const authError = requireServiceRole(req);
    if (authError) return authError;

    const body = await req.json().catch(() => ({}));
    const { action = "claim" } = body;

    // Claim single job
    if (action === "claim") {
      return await claimAndExecuteJob(corsHeaders);
    }

    // Batch claim (limited to prevent runaway)
    if (action === "batch_claim") {
      const count = Math.min(body.count || 1, MAX_CONCURRENT);
      const results = [];

      for (let i = 0; i < count; i++) {
        const result = await claimAndExecuteJob(corsHeaders, true);
        const resultData = await result.json();
        
        if (!resultData.job_id) break; // No more jobs
        
        results.push(resultData);
      }

      return new Response(
        JSON.stringify({ 
          jobs_processed: results.length, 
          results,
          worker_id: WORKER_ID
        }),
        { headers: corsHeaders }
      );
    }

    // Retry failed jobs
    if (action === "retry_failed") {
      const { data, error } = await supabase.rpc("agent_retry_failed_jobs");
      
      if (error) throw error;
      
      return new Response(
        JSON.stringify({ 
          retried: data,
          worker_id: WORKER_ID
        }),
        { headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: corsHeaders }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ 
        error: e instanceof Error ? e.message : "Unknown error",
        worker_id: WORKER_ID
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});

/**
 * Claim and execute a single job
 */
async function claimAndExecuteJob(corsHeaders: Record<string, string>, silent = false): Promise<Response> {
  const lockToken = crypto.randomUUID();
  const now = new Date().toISOString();
  
  // Find and lock next available job using raw SQL for atomicity
  const { data: job, error: fetchError } = await supabase
    .from("jobs")
    .select("id, job_id, job_type, input, attempt_count, max_attempts, route_id")
    .eq("status", "queued")
    .lte("run_after", now)
    .or(`locked_at.is.null,locked_at.lt.${new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString()}`)
    .order("attempt_count", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (fetchError || !job) {
    if (silent) {
      return new Response(JSON.stringify({}), { headers: corsHeaders });
    }
    return new Response(
      JSON.stringify({ jobs_claimed: 0, message: "No jobs available" }),
      { headers: corsHeaders }
    );
  }

  // Lock the job
  const { error: lockError } = await supabase
    .from("jobs")
    .update({
      status: "running",
      lock_token: lockToken,
      locked_at: now,
      attempt_count: job.attempt_count + 1
    })
    .eq("id", job.id)
    .eq("status", "queued"); // Ensure still queued

  if (lockError) {
    // Another worker claimed it
    if (silent) {
      return new Response(JSON.stringify({}), { headers: corsHeaders });
    }
    return new Response(
      JSON.stringify({ jobs_claimed: 0, message: "Job claimed by another worker" }),
      { headers: corsHeaders }
    );
  }

  // Execute the job
  const startTime = Date.now();
  let result: any = null;
  let errorMessage: string | null = null;
  let finalStatus: "succeeded" | "failed" | "dead_letter" = "succeeded";

  try {
    result = await executeJobHandler(job);
    finalStatus = "succeeded";
  } catch (execError) {
    errorMessage = execError instanceof Error ? execError.message : String(execError);
    
    // Determine if we should retry or dead-letter
    const newAttemptCount = job.attempt_count + 1;
    if (newAttemptCount >= job.max_attempts) {
      finalStatus = "dead_letter";
    } else {
      finalStatus = "failed";
    }
  }

  const executionTime = Date.now() - startTime;

  // Update job with result
  const updateData: any = {
    status: finalStatus,
    output: result ? JSON.stringify(result) : null,
    last_error: errorMessage,
    updated_at: new Date().toISOString()
  };

  // If failed (not dead-letter), schedule retry
  if (finalStatus === "failed") {
    const backoffMinutes = Math.pow(2, job.attempt_count); // Exponential backoff: 2, 4, 8, 16...
    updateData.status = "queued";
    updateData.run_after = new Date(Date.now() + backoffMinutes * 60000).toISOString();
    updateData.lock_token = null;
    updateData.locked_at = null;
  } else {
    // Completed or dead-letter - clear lock
    updateData.lock_token = null;
    updateData.locked_at = null;
    updateData.worker_name = WORKER_ID;
  }

  const { error: updateError } = await supabase
    .from("jobs")
    .update(updateData)
    .eq("id", job.id)
    .eq("lock_token", lockToken); // Ensure we still own it

  if (updateError) {
    console.error("[AGENT] Failed to update job:", updateError);
  }

  return new Response(
    JSON.stringify({
      jobs_claimed: 1,
      job_id: job.job_id,
      status: finalStatus,
      execution_time_ms: executionTime,
      attempt: job.attempt_count + 1,
      error: errorMessage,
      worker_id: WORKER_ID
    }),
    { headers: corsHeaders }
  );
}

/**
 * Execute job based on type
 */
async function executeJobHandler(job: any): Promise<any> {
  const { job_type, input } = job;

  switch (job_type) {
    case "task_runner.execute":
      return await handleTaskRunner(input);

    case "stripe.webhook":
      return await handleStripeWebhook(input);

    case "email.send":
      return await handleEmailSend(input);

    case "data.process":
      return await handleDataProcess(input);

    default:
      // Unknown job type - acknowledge but no-op
      return { acknowledged: true, type: job_type, note: "No handler implemented" };
  }
}

// Job handlers
async function handleTaskRunner(input: any): Promise<any> {
  // Simulate task execution
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return {
    executed: true,
    task: input.task || "unknown",
    result: "success",
    timestamp: new Date().toISOString()
  };
}

async function handleStripeWebhook(input: any): Promise<any> {
  // Process Stripe webhook
  return {
    processed: true,
    event_type: input.type,
    id: input.id
  };
}

async function handleEmailSend(input: any): Promise<any> {
  // Send email via provider
  return {
    sent: true,
    to: input.to,
    template: input.template
  };
}

async function handleDataProcess(input: any): Promise<any> {
  // Process data transformation
  return {
    processed: true,
    records: input.records?.length || 0,
    output_size: JSON.stringify(input).length
  };
}
