import { createClient } from "npm:@supabase/supabase-js@2.49.8";

type ExecuteRequest = {
  action_id?: string;
  limit?: number;
};

type OperatorAction = {
  id: string;
  conversation_id: string;
  requested_by: string;
  action_name: "create_invoice" | "pause_subscription" | "create_support_ticket";
  action_input: Record<string, unknown>;
  action_status: "queued" | "running" | "success" | "failed";
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required Supabase environment variables.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function setActionRunning(actionId: string) {
  const { error } = await supabase
    .from("operator_actions")
    .update({ action_status: "running", updated_at: new Date().toISOString() })
    .eq("id", actionId)
    .eq("action_status", "queued");

  if (error) throw error;
}

async function completeAction(action: OperatorAction, output: Record<string, unknown>) {
  const { error: actionErr } = await supabase
    .from("operator_actions")
    .update({
      action_status: "success",
      action_output: output,
      error_text: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", action.id);

  if (actionErr) throw actionErr;

  const { error: msgErr } = await supabase.from("chat_messages").insert({
    conversation_id: action.conversation_id,
    sender_type: "system",
    content: `Action completed: ${action.action_name}`,
    tool_call: {
      action_id: action.id,
      action_name: action.action_name,
      status: "success",
      output,
    },
  });

  if (msgErr) throw msgErr;
}

async function failAction(action: OperatorAction, errorText: string) {
  await supabase
    .from("operator_actions")
    .update({
      action_status: "failed",
      error_text: errorText,
      updated_at: new Date().toISOString(),
    })
    .eq("id", action.id);

  await supabase.from("chat_messages").insert({
    conversation_id: action.conversation_id,
    sender_type: "system",
    content: `Action failed: ${action.action_name}`,
    tool_call: {
      action_id: action.id,
      action_name: action.action_name,
      status: "failed",
      error: errorText,
    },
  });
}

async function runWhitelistedTool(action: OperatorAction): Promise<Record<string, unknown>> {
  switch (action.action_name) {
    case "create_invoice": {
      // Expected RPC (create it in SQL): public.tool_create_invoice(customer_id uuid, amount_cents int, note text)
      const { data, error } = await supabase.rpc("tool_create_invoice", {
        p_requested_by: action.requested_by,
        p_input: action.action_input,
      });
      if (error) throw new Error(`tool_create_invoice failed: ${error.message}`);
      return { tool: "create_invoice", data: data ?? null };
    }

    case "pause_subscription": {
      // Expected RPC (create it in SQL): public.tool_pause_subscription(subscription_id text, reason text)
      const { data, error } = await supabase.rpc("tool_pause_subscription", {
        p_requested_by: action.requested_by,
        p_input: action.action_input,
      });
      if (error) throw new Error(`tool_pause_subscription failed: ${error.message}`);
      return { tool: "pause_subscription", data: data ?? null };
    }

    case "create_support_ticket": {
      // Expected RPC (create it in SQL): public.tool_create_support_ticket(subject text, body text, priority text)
      const { data, error } = await supabase.rpc("tool_create_support_ticket", {
        p_requested_by: action.requested_by,
        p_input: action.action_input,
      });
      if (error) throw new Error(`tool_create_support_ticket failed: ${error.message}`);
      return { tool: "create_support_ticket", data: data ?? null };
    }

    default:
      throw new Error("Action not allowed");
  }
}

async function fetchQueuedActions(reqBody: ExecuteRequest): Promise<OperatorAction[]> {
  if (reqBody.action_id) {
    const { data, error } = await supabase
      .from("operator_actions")
      .select("id, conversation_id, requested_by, action_name, action_input, action_status")
      .eq("id", reqBody.action_id)
      .eq("action_status", "queued")
      .limit(1);

    if (error) throw error;
    return (data ?? []) as OperatorAction[];
  }

  const limit = Math.min(Math.max(reqBody.limit ?? 5, 1), 25);
  const { data, error } = await supabase
    .from("operator_actions")
    .select("id, conversation_id, requested_by, action_name, action_input, action_status")
    .eq("action_status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as OperatorAction[];
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === "GET") {
      return json({ 
        status: "active", 
        service: "tool-executor", 
        version: "1.0.0",
        message: "Tool executor is running and ready to process queued actions"
      });
    }
    
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = (await req.json().catch(() => ({}))) as ExecuteRequest;
    const actions = await fetchQueuedActions(body);

    if (actions.length === 0) {
      return json({ ok: true, processed: 0, message: "No queued actions" });
    }

    const results: Array<{ action_id: string; status: "success" | "failed"; detail?: string }> = [];

    for (const action of actions) {
      try {
        await setActionRunning(action.id);
        const output = await runWhitelistedTool(action);
        await completeAction(action, output);
        results.push({ action_id: action.id, status: "success" });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        await failAction(action, message);
        results.push({ action_id: action.id, status: "failed", detail: message });
      }
    }

    return json({ ok: true, processed: results.length, results });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});
