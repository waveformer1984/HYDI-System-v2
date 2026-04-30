/**
 * Keymaker Gate Edge Function
 * 
 * Validates keys, checks permissions, and routes requests.
 * This is the "door" - every request passes through here first.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.32.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, x-keymaker-key, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    const body = await req.json();
    const { 
      key_hash,
      service_id,
      path,
      method = "GET",
      metadata = {},
      payload = null
    } = body;

    // Validate required fields
    if (!key_hash) {
      return new Response(
        JSON.stringify({
          allowed: false,
          reason: "missing_key",
          error: "Keymaker key is required"
        }),
        { 
          status: 401, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    if (!service_id) {
      return new Response(
        JSON.stringify({
          allowed: false,
          reason: "missing_service",
          error: "Service ID is required"
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    // Call the Keymaker validation function
    const { data, error } = await supabase.rpc("keymaker_validate_and_route", {
      p_key_hash: key_hash,
      p_service_id: service_id,
      p_path: path || "/",
      p_method: method,
      p_metadata: metadata
    });

    if (error) {
      console.error("[KEYMAKER] Validation error:", error);
      return new Response(
        JSON.stringify({
          allowed: false,
          reason: "system_error",
          error: error.message
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    const result = data as any;

    // Log the access attempt
    await supabase.from("keymaker_events").insert({
      event_id: `gate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: "keymaker_access_attempt",
      source: "keymaker-gate",
      severity: result.allowed ? "info" : "warning",
      payload: {
        service_id,
        path,
        method,
        allowed: result.allowed,
        reason: result.reason,
        execution_path: result.execution_path || null,
        request_id: result.request_id
      },
      occurred_at: new Date().toISOString()
    });

    // If allowed and there's a payload, queue a job
    if (result.allowed && payload) {
      const { data: jobData, error: jobError } = await supabase
        .rpc("agent_create_job", {
          p_job_type: "service_request",
          p_payload: {
            service_id,
            path,
            method,
            payload,
            identity: result.identity,
            execution_path: result.execution_path
          },
          p_priority: result.priority === "high" ? 10 : result.priority === "medium" ? 5 : 0,
          p_target_service: service_id
        });

      if (jobError) {
        console.error("[KEYMAKER] Job creation error:", jobError);
      } else {
        result.job_id = jobData;
      }
    }

    return new Response(
      JSON.stringify(result),
      { 
        status: result.allowed ? 200 : 403, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (err) {
    console.error("[KEYMAKER] Gate error:", err);
    return new Response(
      JSON.stringify({
        allowed: false,
        reason: "gate_error",
        error: err.message
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
