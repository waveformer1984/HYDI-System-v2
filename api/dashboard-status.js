import { createHmac } from 'crypto';
import { createClient } from "@supabase/supabase-js";
import cors from '../lib/cors.js';
import { setBridgeSnapshot, getBridgeSnapshot } from "../lib/dashboard-bridge-store.js";

const { handleCors } = cors;

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase env vars not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    }
    _supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

const AGENTS = ["Heidi", "Ursula", "CASCADE", "KILO", "ProtoForge", "Hyve"];
const BRIDGE_REQUIRED = new Set(['source', 'version', 'checkedAt', 'snapshot_id', 'agents', 'pipeline', 'supabase', 'infrastructure', 'collector']);

// Bounded replay-protection cache. Maps snapshot_id -> timestamp.
const seenSnapshotIds = new Map();
const MAX_ID_AGE_MS = 30 * 60 * 1000;

function pruneSeenIds(now = Date.now()) {
  for (const [id, ts] of seenSnapshotIds) {
    if (now - ts > MAX_ID_AGE_MS) {
      seenSnapshotIds.delete(id);
    }
  }
}

function isNewSnapshot(id, ts) {
  pruneSeenIds(ts);
  if (seenSnapshotIds.has(id)) return false;
  seenSnapshotIds.set(id, ts);
  return true;
}

function normalizeStatus(status) {
  const s = String(status || "unknown").toLowerCase().trim();
  if (["ok", "healthy", "up", "active", "online", "operational"].includes(s)) return "ok";
  if (["warning", "degraded", "warn"].includes(s)) return "degraded";
  if (["critical", "down", "error", "failed", "unreachable"].includes(s)) return "down";
  return "unknown";
}

function pipelineMap(dash) {
  if (!dash) return { status: "unknown", current_status: "unknown", detail: "no system_dashboard data" };
  const current = dash.current_status || "unknown";
  let status = "unknown";
  if (current === "OK") status = "ok";
  else if (current === "WARNING") status = "degraded";
  else if (current === "CRITICAL") status = "down";
  return {
    status,
    current_status: current,
    trend_status: dash.trend_status || "unknown",
    escalation_level: dash.escalation_level || "unknown",
    jobs_queued: dash.jobs_queued ?? null,
    jobs_failed: dash.jobs_failed ?? null,
    last_check: dash.last_check || null,
    detail: dash.trend_reason || dash.escalation_reason || null,
  };
}

function bridgeAgeMs(snapshot) {
  if (!snapshot || !snapshot.receivedAt) return Infinity;
  const ts = new Date(snapshot.receivedAt).getTime();
  return Number.isNaN(ts) ? Infinity : Date.now() - ts;
}

function isBridgeFresh(snapshot) {
  return bridgeAgeMs(snapshot) < 10 * 60 * 1000;
}

function isBridgeStale(snapshot) {
  const age = bridgeAgeMs(snapshot);
  return age >= 10 * 60 * 1000 && age < 30 * 60 * 1000;
}

function verifySignature(data, signature, secret) {
  const expected = createHmac('sha256', secret).update(data).digest('hex');
  try {
    return signature.length === expected.length && expected === signature;
  } catch {
    return false;
  }
}

function validateBridgePayload(payload) {
  if (!payload || typeof payload !== 'object') return 'payload must be an object';
  const missing = [...BRIDGE_REQUIRED].filter(f => !(f in payload));
  if (missing.length > 0) return `missing fields: ${missing.join(', ')}`;
  if (typeof payload.snapshot_id !== 'string' || payload.snapshot_id.length < 8) return 'snapshot_id must be a string of at least 8 characters';
  if (!Array.isArray(payload.agents)) return 'agents must be an array';
  if (!payload.pipeline || typeof payload.pipeline !== 'object') return 'pipeline must be an object';
  if (!payload.supabase || typeof payload.supabase !== 'object') return 'supabase must be an object';
  return null;
}

async function handleGet(req, res) {
  const token = process.env.DASHBOARD_STATUS_TOKEN;
  if (token) {
    const auth = req.headers.authorization || "";
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match || match[1] !== token) {
      return res.status(401).json({
        error: "Unauthorized",
        hint: "Set Authorization: Bearer <DASHBOARD_STATUS_TOKEN>",
        checkedAt: new Date().toISOString(),
      });
    }
  }

  const started = Date.now();
  let supabaseDetail = "connecting...";

  try {
    const [
      { data: dash, error: dashError },
      { data: healthRows, error: healthError },
      { data: infra, error: infraError },
    ] = await Promise.all([
      supabase.from("system_dashboard").select("*").single(),
      supabase
        .from("system_health")
        .select("component,status,last_check,message")
        .order("component"),
      supabase
        .from("infrastructure_health")
        .select("*")
        .eq("id", "singleton")
        .single(),
    ]);

    supabaseDetail = dashError
      ? (dashError.message || "SUPABASE_NETWORK_ERROR")
      : (healthError ? "system_dashboard reachable; system_health not available" : "supabase reachable");

    if (!dashError) {
      const healthMap = new Map();
      if (healthRows) {
        for (const row of healthRows) {
          if (row.component) healthMap.set(row.component, row);
        }
      }

      const agents = AGENTS.map((name) => {
        const row =
          healthMap.get(name) ||
          healthMap.get(name.toLowerCase()) ||
          null;
        return {
          name,
          status: row ? normalizeStatus(row.status) : "unknown",
          detail: row?.message || (row ? `status: ${row.status}` : "no system_health row found"),
          last_check: row?.last_check || null,
        };
      });

      const pipeline = pipelineMap(dash);

      return res.status(200).json({
        status_source: "supabase",
        agents,
        supabase: { status: "ok", detail: supabaseDetail },
        pipeline,
        infrastructure: infraError ? null : infra,
        checkedAt: new Date().toISOString(),
        ms: Date.now() - started,
        auth: token ? "bearer-token" : "none",
      });
    }
  } catch (error) {
    console.error("Supabase dashboard status error:", error);
    supabaseDetail = error instanceof Error ? error.message : "SUPABASE_NETWORK_ERROR";
  }

  const bridge = getBridgeSnapshot();
  if (bridge && isBridgeFresh(bridge)) {
    return res.status(200).json({
      status_source: "local-hydi",
      agents: bridge.agents || AGENTS.map(name => ({ name, status: "unknown", detail: "no bridge agent data", last_check: null })),
      supabase: { status: "down", detail: supabaseDetail },
      pipeline: bridge.pipeline || { status: "unknown", current_status: "unknown" },
      infrastructure: bridge.infrastructure || null,
      checkedAt: new Date().toISOString(),
      ms: Date.now() - started,
      auth: token ? "bearer-token" : "none",
    });
  }

  if (bridge && isBridgeStale(bridge)) {
    return res.status(200).json({
      status_source: "degraded",
      agents: bridge.agents || AGENTS.map(name => ({ name, status: "unknown", detail: "no bridge agent data", last_check: null })),
      supabase: { status: "down", detail: supabaseDetail + "; bridge is stale" },
      pipeline: bridge.pipeline || { status: "unknown", current_status: "unknown" },
      infrastructure: bridge.infrastructure || null,
      checkedAt: new Date().toISOString(),
      ms: Date.now() - started,
      auth: token ? "bearer-token" : "none",
    });
  }

  return res.status(503).json({
    status_source: "unavailable",
    agents: AGENTS.map((name) => ({ name, status: "unknown", detail: "no data source", last_check: null })),
    supabase: { status: "down", detail: supabaseDetail },
    pipeline: { status: "unknown", current_status: "unknown" },
    infrastructure: null,
    checkedAt: new Date().toISOString(),
    ms: Date.now() - started,
    auth: token ? "bearer-token" : "none",
  });
}

async function handlePost(req, res) {
  const auth = req.headers['authorization'] || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const secret = process.env.HYDI_STATUS_BRIDGE_SECRET;
  if (!secret || !match || match[1] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let body;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'Malformed JSON' });
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Malformed JSON' });
  }

  const { payload, payload_raw, signature, algorithm, timestamp } = body;
  if ((!payload && !payload_raw) || !signature || !algorithm || !timestamp) {
    return res.status(400).json({ error: 'Missing snapshot fields' });
  }
  if (algorithm !== 'hmac-sha256') {
    return res.status(422).json({ error: 'Unsupported algorithm' });
  }
  const ts = new Date(timestamp).getTime();
  if (Number.isNaN(ts) || Date.now() - ts > 30 * 60 * 1000) {
    return res.status(422).json({ error: 'Snapshot expired' });
  }
  if (ts > Date.now() + 60 * 1000) {
    return res.status(422).json({ error: 'Snapshot timestamp is in the future' });
  }

  const raw = payload_raw || JSON.stringify(payload);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return res.status(422).json({ error: 'Malformed payload JSON' });
  }

  const schemaError = validateBridgePayload(parsed);
  if (schemaError) {
    return res.status(422).json({ error: schemaError });
  }

  if (!verifySignature(raw, signature, secret)) {
    return res.status(422).json({ error: 'Invalid signature' });
  }

  if (!isNewSnapshot(parsed.snapshot_id, Date.now())) {
    return res.status(422).json({ error: 'Snapshot replayed' });
  }

  setBridgeSnapshot({
    ...parsed,
    receivedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString()
  });

  return res.status(200).json({ accepted: true, checkedAt: parsed.checkedAt });
}

export default async function handler(req, res) {
  const corsOk = handleCors(req, res, {
    allowedMethods: 'GET, POST, OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
  });
  if (!corsOk) {
    return;
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method === "GET") {
    return handleGet(req, res);
  }

  if (req.method === "POST") {
    return handlePost(req, res);
  }

  return res.status(405).json({ error: "Method not allowed" });
}
