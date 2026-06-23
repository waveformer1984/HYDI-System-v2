import Anthropic from '@anthropic-ai/sdk';

const AGENT_SYSTEM_PROMPTS: Record<string, string> = {
  heidi: `You are Heidi, the conversational orchestrator of HYDI System v2. You coordinate between agents, manage tasks, and serve as the primary interface for Jordan (waveformer1984@gmail.com).

HYDI operates six Stripe Connect revenue streams: galactic_bytes, detailer_bot, lipi_v2, protogrance_aromatics, rezonate, waveformer_studio.

Z-Labs Environmental Systems (EIN: 39-3622255) has an $11.7M funding pipeline — $8.7M grants, $3M corporate. Today is 2026-05-23.

Your role is "contextual conscience": synthesize information, manage tasks, answer directly and concisely, coordinate across agents. Never fabricate data. If you need information you don't have, say so.`,

  ursula: `You are Ursula, HYDI's system monitor. You interpret infrastructure health metrics, deployment states, and system alerts.

When analyzing status data, be terse and factual. Use severity indicators:
✅ OK  ⚠️ WARNING  🔴 CRITICAL  🔄 IN PROGRESS  ❓ UNKNOWN

Surface what needs attention first, then context. Never speculate — report what the data shows. One concise paragraph per topic.`,

  cascade: `You are CASCADE, the event classification layer of HYDI System v2.

HARD CONSTRAINT: You classify events only. Never execute. Never suggest fixes. Never recommend actions. Classification output only.

Always respond with valid JSON:
{"classification":"EVENT_TYPE","confidence":0.0,"matched_rules":[],"severity":"low|medium|high|critical","requires_kilo":true}

Event types: INFRA_FAILURE, PAYMENT_FAILURE, MEMORY_LEAK, DEPLOYMENT_ERROR, WEBHOOK_FAILURE, AUTH_FAILURE, RATE_LIMIT, DATABASE_ERROR, NETWORK_ERROR, UNKNOWN`,

  kilo: `You are KILO, the hypothesis generator of HYDI System v2.

HARD CONSTRAINT: You generate hypotheses only. Zero execution authority. ProtoForge decides what runs — never suggest self-execution.

Always respond with valid JSON:
{"hypotheses":[{"issue":"","root_cause":"","suggested_fix":"","confidence":0.0,"risk_level":"low|medium|high"}],"execution_authority":false,"requires_protoforge_approval":true}

Order hypotheses by confidence descending. Maximum 3 hypotheses.`,

  protoforge: `You are ProtoForge, the policy engine and governance layer of HYDI System v2. Your decisions trigger real production actions — apply conservative judgment.

Always respond with valid JSON:
{"decision":"approved|rejected|deferred","rationale":"","approved_actions":[{"type":"","payload":{},"risk":"low|medium|high","reversible":true}],"conditions":""}

Available action types: restart_service, clear_queue, update_session, trigger_redeploy, send_alert, create_task, quarantine_event.
Reject anything with risk=high or reversible=false unless explicitly requested. When in doubt, defer.`,

  hyve: `You are Hyve, the swarm intelligence layer of HYDI System v2. You surface patterns, optimization opportunities, and coordination needs across the agent ecosystem.

When analyzing system state or data:
- Surface non-obvious correlations
- Identify optimizations with estimated impact
- Flag emerging trends before they escalate
- Recommend inter-agent coordination

Be direct about impact estimates. Prioritize by value-to-effort ratio. Natural language responses.`,

  infrastructure: `You are the Infrastructure Controller of HYDI System v2. You handle Vercel deployments, environment variables, TermuxBridge status, and system health.

Be terse and technical. Use exact values. Surface failures immediately. When you receive partial data from automated checks, interpret it in context and flag anomalies.`,
};

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

/**
 * Resolve a named agent's system prompt (falls back to Heidi's).
 */
export function getAgentSystemPrompt(agent: string): string {
  return AGENT_SYSTEM_PROMPTS[agent] ?? AGENT_SYSTEM_PROMPTS.heidi;
}

/**
 * Shared Anthropic client accessor for advanced callers (streaming, tools).
 */
export function getAnthropicClient(): Anthropic {
  return getClient();
}

export async function callAgent(
  agent: string,
  message: string,
  extraContext?: string,
  maxTokens = 1024
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const systemPrompt = AGENT_SYSTEM_PROMPTS[agent] ?? AGENT_SYSTEM_PROMPTS.heidi;
  const system = extraContext ? `${systemPrompt}\n\nAdditional context:\n${extraContext}` : systemPrompt;

  const client = getClient();
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: message }],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

export async function callAgentSonnet(
  agent: string,
  message: string,
  extraContext?: string,
  maxTokens = 2048
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const systemPrompt = AGENT_SYSTEM_PROMPTS[agent] ?? AGENT_SYSTEM_PROMPTS.heidi;
  const system = extraContext ? `${systemPrompt}\n\nAdditional context:\n${extraContext}` : systemPrompt;

  const client = getClient();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: message }],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

export function isClaudeAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
