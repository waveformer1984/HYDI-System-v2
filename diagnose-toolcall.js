/**
 * diagnose-toolcall.js
 *
 * Standalone diagnostic — replicates the EXACT request launch-heidi-mobile.js
 * sends to Ollama for a chat turn (full system prompt + all 13 tools +
 * one user message), with stream:false. Prints whether tool_calls came back.
 *
 * Run: node diagnose-toolcall.js
 */
'use strict';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.argv[2] || 'llama3.2:latest';

const REVENUE_STREAMS = ['galactic_bytes','detailer_bot','lipi_v2','protogrance_aromatics','rezonate','waveformer_studio'];

const TOOLS = [
    { type: 'function', function: { name: 'get_system_health', description: 'Check health of local AI services (Ollama, LM Studio) and list available models', parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'get_hydi_status', description: 'Get current ProtoForge backend status — queries Ursula (Flask/5000), Protohub (Node/4000), and HYDI. Returns service health, database connection, build count, and event metrics.', parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'get_build_status', description: 'Get ProtoForge forge runner build history and pipeline status from Ursula. Returns total builds, recent build list, and current forge cycle state.', parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Number of recent builds to return (default 10, max 50)' } }, required: [] } } },
    { type: 'function', function: { name: 'run_command', description: 'Execute a safe read-only shell command (ps, free, df, uptime, ls, etc.)', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Shell command to run' } }, required: ['command'] } } },
    { type: 'function', function: { name: 'read_file', description: 'Read a file from the project directory', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root or absolute' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'get_current_time', description: 'Get the current date, time, and timezone', parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'get_ursula_live', description: 'Query the live Ursula Vercel app directly (https://ursula-nine.vercel.app). Fetches real-time system health, revenue data, or any API route. Pass a path like /api/health, /api/revenue, /api/ursula/status.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'API path to fetch, e.g. /api/health or /api/revenue' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'get_rezonate_score', description: 'Get Rezonate DAW completion score, estimated monthly revenue, pricing tiers, and scaffolding suggestions from the local rezonate_core module via heidi-bridge.', parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'query_database', description: 'Run a read-only SELECT query against the ProtoForge SQLite database (protoforge.db) via heidi-bridge. Use to inspect leads, builds, sessions, revenue entries, or any table.', parameters: { type: 'object', properties: { sql: { type: 'string', description: 'A SELECT SQL query to run against protoforge.db' } }, required: ['sql'] } } },
    { type: 'function', function: { name: 'get_revenue_summary', description: 'Get revenue totals from the ProtoForge ledger. Shows gross, net, and transaction counts by stream.', parameters: { type: 'object', properties: { stream: { type: 'string', description: 'Filter by stream name. Omit for all 6 streams.' }, days: { type: 'integer', description: 'Days to look back. Default: 30.' } }, required: [] } } },
    { type: 'function', function: { name: 'get_revenue_pipeline', description: 'Get leads, quotes, and proposals from the ProtoForge revenue pipeline.', parameters: { type: 'object', properties: { stage: { type: 'string', description: 'Filter by stage: leads, quotes, or proposals. Omit for all.' }, limit: { type: 'integer', description: 'Max records per stage. Default: 5.' } }, required: [] } } },
    { type: 'function', function: { name: 'create_lead', description: 'Create a new client lead in the revenue pipeline. AUTHORIZATION REQUIRED: always show the user all details and wait for explicit CONFIRM before calling this tool.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Client or company name' }, email: { type: 'string', description: 'Client email address' }, service: { type: 'string', description: 'Service or product description' }, stream: { type: 'string', description: 'Revenue stream: ' + REVENUE_STREAMS.join(', ') }, estimated_value: { type: 'number', description: 'Estimated deal value in dollars' }, notes: { type: 'string', description: 'Additional notes' } }, required: ['name', 'service', 'stream'] } } },
    { type: 'function', function: { name: 'generate_checkout_link', description: 'Generate a live Stripe checkout payment link to send to a client. AUTHORIZATION REQUIRED: present full details and wait for CONFIRM. Returns a payment URL.', parameters: { type: 'object', properties: { amount_cents: { type: 'integer', description: 'Amount in cents. E.g. 50000 = $500.00' }, description: { type: 'string', description: 'Product/service name shown on Stripe checkout' }, stream: { type: 'string', description: 'Revenue stream: ' + REVENUE_STREAMS.join(', ') }, client_email: { type: 'string', description: 'Pre-fill client email (optional)' }, currency: { type: 'string', description: 'ISO currency code. Default: usd' } }, required: ['amount_cents', 'description', 'stream'] } } },
    { type: 'function', function: { name: 'get_payout_status', description: 'Check payout status and net balances from the ledger by stream.', parameters: { type: 'object', properties: { stream: { type: 'string', description: 'Filter by stream. Omit for all.' } }, required: [] } } },
];

const SYSTEM_PROMPT = `You are Heidi, the AI command interface for the ProtoForge ecosystem — an autonomous revenue-generating platform.
You run locally via Ollama on Android/Termux. The operator directs you to manage and grow revenue.

LIVE BACKEND:
  Ursula (cloud)  — https://ursula-nine.vercel.app — Next.js/Supabase, live now
                    Routes: /api/health, /api/ursula/status, /api/revenue, /api/chat
  Heidi Bridge    — http://localhost:5050 (Windows) — reads protoforge.db + build_registry.json
                    Routes: /health, /api/builds, /api/metrics, /api/db/query, /api/rezonate/score
  Protohub        — http://localhost:4000 — Node/Express, JWT auth, Stripe billing (Pro $49, Enterprise $199)
  Forge           — forge_runner.py: 545+ builds, protoforge.db (SQLite), build_registry.json

MODULES (in Ursula_Suite):
  Proto.I.Y · BlameGames · PorchWise · Rezonette (DAW) · Checkpoint QA

SYSTEM TOOLS: get_system_health, get_hydi_status, get_build_status, get_ursula_live, get_rezonate_score, query_database, run_command, read_file, get_current_time
REVENUE TOOLS: get_revenue_summary, get_revenue_pipeline, create_lead, generate_checkout_link, get_payout_status

REVENUE STREAMS: galactic_bytes | detailer_bot | lipi_v2 | protogrance_aromatics | rezonate | waveformer_studio

TOOL USE — MANDATORY:
You have real function-calling. When a request requires a tool above, you MUST emit an actual tool call — never describe, narrate, or print a shell command, code block, or "you can run..." instructions. Do not invent tool names (e.g. there is no "protopage" tool — only the tools listed above exist). If you are unsure which tool applies, pick the closest real one and call it; do not fall back to prose.

AUTHORIZATION PROTOCOL — MANDATORY for create_lead and generate_checkout_link:
  1. Before calling either tool, present a summary: action type, all parameters, dollar amount.
  2. End with: "Reply CONFIRM to authorize."
  3. Wait for the operator to reply CONFIRM (or equivalent). Do not proceed without it.
  4. After confirmation, call the tool and report the result.

Be direct and concise. Treat the operator as the system owner with full authority.
Current time: ${new Date().toLocaleString()}
HYDI: offline`;

const USER_MESSAGE = 'Use your get_ursula_live tool with path /api/health to check the live Ursula Vercel app status.';

(async () => {
    console.log(`Model: ${MODEL}`);
    console.log(`Tools sent: ${TOOLS.length}`);
    console.log('--- Sending request (stream:false) ---\n');

    const body = {
        model: MODEL,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: USER_MESSAGE },
        ],
        stream: false,
        tools: TOOLS,
        options: { temperature: 0.7, num_predict: 600 },
    };

    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        console.error(`HTTP ${res.status}`);
        console.error(await res.text());
        process.exit(1);
    }

    const data = await res.json();
    console.log('content:', JSON.stringify(data.message?.content ?? null));
    console.log('tool_calls:', JSON.stringify(data.message?.tool_calls ?? null, null, 2));
    console.log('\n--- Full message object ---');
    console.log(JSON.stringify(data.message, null, 2));
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
