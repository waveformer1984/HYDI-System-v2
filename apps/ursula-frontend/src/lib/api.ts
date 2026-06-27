/**
 * API Client — Centralized fetch layer for live mode
 * 
 * Provides typed fetch functions for each ProtoForge service.
 * Only called when mode === 'live'. Test mode uses local mock data.
 * 
 * Config: Set NEXT_PUBLIC_* env vars in .env.local for each service URL.
 * Error handling: All fetches return { data, error } — never throws.
 * 
 * Endpoints:
 *   - Payment Gateway: NEXT_PUBLIC_GATEWAY_URL (Railway)
 *   - Supabase: NEXT_PUBLIC_SUPABASE_URL
 *   - SiteGrade: NEXT_PUBLIC_SITEGRADE_URL
 */

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://web-backend-production-9170.up.railway.app';
const SITEGRADE_URL = process.env.NEXT_PUBLIC_SITEGRADE_URL || '';
const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL || 'https://payment-auto-production.up.railway.app';

export interface ApiResult<T> {
  data: T | null;
  error: string | null;
  status: number;
}

async function safeFetch<T>(url: string, options?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
    if (!res.ok) {
      return { data: null, error: `HTTP ${res.status}: ${res.statusText}`, status: res.status };
    }
    const data = await res.json();
    return { data, error: null, status: res.status };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error', status: 0 };
  }
}

/** Check if Payment Gateway is reachable */
export async function checkGatewayHealth(): Promise<ApiResult<{ status: string }>> {
  if (!GATEWAY_URL) return { data: null, error: 'NEXT_PUBLIC_GATEWAY_URL not configured', status: 0 };
  return safeFetch(`${GATEWAY_URL}/health`);
}

/** Get gateway docs/info */
export async function getGatewayInfo(): Promise<ApiResult<Record<string, unknown>>> {
  if (!GATEWAY_URL) return { data: null, error: 'NEXT_PUBLIC_GATEWAY_URL not configured', status: 0 };
  return safeFetch(`${GATEWAY_URL}/docs`);
}

/** Check SiteGrade API health */
export async function checkSiteGradeHealth(): Promise<ApiResult<{ status: string }>> {
  if (!SITEGRADE_URL) return { data: null, error: 'NEXT_PUBLIC_SITEGRADE_URL not configured', status: 0 };
  return safeFetch(`${SITEGRADE_URL}/api/health`);
}

/** Check webhook relay health */
export async function checkRelayHealth(): Promise<ApiResult<{ status: string }>> {
  return safeFetch(`${RELAY_URL}/api/health`);
}

/** Generic health check — ping any URL */
export async function pingService(url: string): Promise<{ ok: boolean; ms: number; error?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(url, { method: 'HEAD', mode: 'no-cors' });
    return { ok: true, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: err instanceof Error ? err.message : 'Failed' };
  }
}

// =============================================================================
// Project Ops API
// =============================================================================

const PROJECT_OPS_URL = process.env.NEXT_PUBLIC_PROJECT_OPS_URL || 'http://localhost:3100';

/** Check Project Ops API health */
export async function checkProjectOpsHealth(): Promise<ApiResult<{ status: string; uptime: number }>> {
  return safeFetch(`${PROJECT_OPS_URL}/health`);
}

/** List all projects */
export async function listProjects(): Promise<ApiResult<{ projects: ProjectSummary[] }>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/projects`);
}

/** Get a single project by ID */
export async function getProject(projectId: string): Promise<ApiResult<{ project: ProjectSummary }>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/projects/${projectId}`);
}

/** List tasks for a project */
export async function listTasks(projectId: string): Promise<ApiResult<{ tasks: TaskItem[] }>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/projects/${projectId}/tasks`);
}

/** List chains for a project */
export async function listChains(projectId: string): Promise<ApiResult<{ chains: ChainItem[] }>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/projects/${projectId}/chains`);
}

/** Get a single chain by ID */
export async function getChain(projectId: string, chainId: string): Promise<ApiResult<{ chain: ChainItem; status: ChainStatus }>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/projects/${projectId}/chains/${chainId}`);
}

/** List PM templates */
export async function listPMTemplates(): Promise<ApiResult<{ templates: PMTemplate[] }>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/pm/templates`);
}

/** List registered agents */
export async function listAgents(): Promise<ApiResult<{ agents: AgentItem[] }>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/agents`);
}

/** Get audit ledger entries */
export async function getLedger(limit?: number): Promise<ApiResult<{ entries: LedgerEntry[] }>> {
  const qs = limit ? `?limit=${limit}` : '';
  return safeFetch(`${PROJECT_OPS_URL}/api/ledger${qs}`);
}

export type OrchestrationActionRisk = 'low' | 'medium' | 'high' | 'critical';
export type OrchestrationActionStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'running'
  | 'completed'
  | 'failed';
export type OrchestrationAdapter = 'cli_command' | 'ollama_generate';

export interface OrchestrationExecutionLogEntry {
  timestamp: string;
  message: string;
}

export interface OrchestrationAction {
  id: string;
  title: string;
  adapter: OrchestrationAdapter;
  payload: Record<string, unknown>;
  status: OrchestrationActionStatus;
  risk_level: OrchestrationActionRisk;
  requested_by: string;
  approved_by: string | null;
  approval_note: string | null;
  created_at: string;
  updated_at: string;
  executed_at: string | null;
  result: Record<string, unknown> | null;
  execution_log: OrchestrationExecutionLogEntry[];
}

export interface RequestOrchestrationActionInput {
  title: string;
  adapter: OrchestrationAdapter;
  payload: Record<string, unknown>;
  risk_level?: OrchestrationActionRisk;
  requested_by?: string;
}

export async function listOrchestrationActions(status?: OrchestrationActionStatus): Promise<ApiResult<{ actions: OrchestrationAction[]; count: number; max_execution_risk: OrchestrationActionRisk }>> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return safeFetch(`${PROJECT_OPS_URL}/api/orchestration/actions${qs}`);
}

export async function requestOrchestrationAction(input: RequestOrchestrationActionInput): Promise<ApiResult<{ action: OrchestrationAction }>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/orchestration/actions`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function approveOrchestrationAction(actionId: string, approvedBy: string, note?: string): Promise<ApiResult<{ action: OrchestrationAction }>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/orchestration/actions/${encodeURIComponent(actionId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ approved_by: approvedBy, note }),
  });
}

export async function rejectOrchestrationAction(actionId: string, rejectedBy: string, note?: string): Promise<ApiResult<{ action: OrchestrationAction }>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/orchestration/actions/${encodeURIComponent(actionId)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ rejected_by: rejectedBy, note }),
  });
}

export async function executeOrchestrationAction(actionId: string): Promise<ApiResult<{ action: OrchestrationAction; error?: string }>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/orchestration/actions/${encodeURIComponent(actionId)}/execute`, {
    method: 'POST',
  });
}

export async function getOrchestrationActionLogs(actionId: string): Promise<ApiResult<{ id: string; status: OrchestrationActionStatus; logs: OrchestrationExecutionLogEntry[]; result: Record<string, unknown> | null }>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/orchestration/actions/${encodeURIComponent(actionId)}/logs`);
}

// =============================================================================
// Project Ops Types (matching server response shapes)
// =============================================================================

export interface ProjectSummary {
  id: string;
  name: string;
  mission: string;
  status: string;
  created_at: string;
  task_count?: number;
}

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: number;
  type: string;
  assigned_to?: string;
  assignment_mode?: string;
  risk_score?: number;
  created_at: string;
  due_at?: string;
  tags?: string[];
}

export interface ChainPhaseItem {
  id: string;
  title: string;
  status: string;
  assignment_mode?: string;
  effort_minutes: number;
  is_gate: boolean;
  gate_status?: string;
  completion_proof?: string | null;
  depends_on: string[];
}

export interface ChainItem {
  id: string;
  objective: string;
  project_id: string;
  phase_count: number;
  total_effort_minutes: number;
  created_at: string;
  tasks: ChainPhaseItem[];
  gates: { id: string; auto_verify: boolean }[];
  metadata: Record<string, unknown>;
}

export interface ChainStatus {
  status: string;
  total_tasks: number;
  completed: number;
  in_progress: number;
  blocked: number;
  not_started: number;
  completion_percentage: number;
}

export interface PMTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  phases: { title: string; effort_minutes?: number }[];
  default_priority: number;
  default_risk: string;
}

export interface AgentItem {
  id: string;
  name: string;
  type: string;
  capabilities: string[];
  status: string;
}

export interface LedgerEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_type: string;
  actor_id: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Model Gateway API
// =============================================================================

/** List all available models with capabilities */
export async function listModels(): Promise<ApiResult<ModelsResponse>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/models`);
}

/** Aggregate health check across model providers */
export async function modelsHealth(): Promise<ApiResult<ModelsHealthResponse>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/models/health`);
}

/** Generate completion using a specific model */
export async function modelGenerate(modelName: string, prompt: string, options?: { system?: string; format?: string; temperature?: number }): Promise<ApiResult<LLMResponse>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/models/${encodeURIComponent(modelName)}/generate`, {
    method: 'POST',
    body: JSON.stringify({ prompt, system: options?.system, format: options?.format, options: options?.temperature != null ? { temperature: options.temperature } : undefined }),
  });
}

/** Chat with a specific model */
export async function modelChat(modelName: string, messages: ChatMessage[], options?: { format?: string; temperature?: number }): Promise<ApiResult<LLMResponse>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/models/${encodeURIComponent(modelName)}/chat`, {
    method: 'POST',
    body: JSON.stringify({ messages, format: options?.format, options: options?.temperature != null ? { temperature: options.temperature } : undefined }),
  });
}

/** FIM code completion for copilot */
export async function copilotComplete(prefix: string, suffix: string, options?: { model?: string; temperature?: number; max_tokens?: number }): Promise<ApiResult<CopilotResponse>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/models/copilot/complete`, {
    method: 'POST',
    body: JSON.stringify({ prefix, suffix, model: options?.model, options: { temperature: options?.temperature, max_tokens: options?.max_tokens } }),
  });
}

/** LLM-powered task decomposition */
export async function llmDecompose(objective: string, context?: string): Promise<ApiResult<{ success: boolean; data?: unknown; raw: string; error?: string; duration_ms: number }>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/llm/decompose`, {
    method: 'POST',
    body: JSON.stringify({ objective, context }),
  });
}

/** LLM-powered intake parsing */
export async function llmIntakeParse(text: string): Promise<ApiResult<{ success: boolean; data?: unknown; raw: string; error?: string; duration_ms: number }>> {
  return safeFetch(`${PROJECT_OPS_URL}/api/llm/intake/parse`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

// Model Gateway Types

export interface ModelInfo {
  name: string;
  family: string;
  size_gb: number;
  modified_at: string;
  digest: string;
  is_default: boolean;
  provider: string;
  capabilities: string[];
}

export interface ModelsResponse {
  provider: string;
  available: boolean;
  version?: string;
  error?: string;
  default_model: string;
  models: ModelInfo[];
}

export interface ModelsHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  providers: {
    name: string;
    available: boolean;
    version: string | null;
    url: string;
    default_model: string;
    default_model_loaded: boolean;
    model_count: number;
  }[];
  timestamp: string;
}

export interface LLMResponse {
  success: boolean;
  response: string;
  model: string;
  duration_ms: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  error?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CopilotResponse {
  completion: string;
  model: string;
  success: boolean;
  duration_ms: number;
  error?: string;
}

// =============================================================================
// HYDI Task Pipeline API
// =============================================================================

const BETA_PORTAL_URL = process.env.NEXT_PUBLIC_BETA_PORTAL_URL || 'https://beta-portal-production.up.railway.app';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://akbnfovjdcobifeupvbn.supabase.co';

export interface HydiTask {
  id: string;
  title: string;
  description?: string;
  priority: string;
  status: string;
  assigned_to?: string;
  created_at?: string;
  data?: {
    source?: string;
    from_address?: string;
    original_subject?: string;
    supabase_id?: string;
  };
  subtasks?: string[];
}

export interface EmailTask {
  id: string;
  subject: string;
  from_address: string;
  to_address: string;
  status: string;
  received_at: string;
  attempts: number;
}

export interface TriggerResult {
  status: string;
  id: string;
  message: string;
}

export interface WebhookHealth {
  status: string;
  supabase_url: string;
  service_key: string;
  email_secret: string;
  timestamp: string;
}

/** Check beta-portal email webhook health */
export async function checkWebhookHealth(): Promise<ApiResult<WebhookHealth>> {
  return safeFetch(`${BETA_PORTAL_URL}/api/hydi/email-trigger/health`);
}

/** Trigger a new HYDI task via the webhook */
export async function triggerHydiTask(subject: string, body?: string): Promise<ApiResult<TriggerResult>> {
  return safeFetch(`${BETA_PORTAL_URL}/api/hydi/email-trigger`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'email.received',
      data: {
        from: 'ursula@protoforgeindustries.com',
        to: ['hydi@protoforgeindustries.com'],
        subject,
        body: body || subject,
        email_id: `ursula-${Date.now()}`,
      },
    }),
  });
}

/** Fetch email tasks from Supabase (requires service key in env) */
export async function fetchEmailTasks(status?: string): Promise<ApiResult<EmailTask[]>> {
  const qs = status ? `&status=eq.${status}` : '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  return safeFetch(`${SUPABASE_URL}/rest/v1/email_tasks?select=id,subject,from_address,to_address,status,received_at,attempts&order=received_at.desc&limit=20${qs}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
}

// =============================================================================
// Ollama Local Model API (Direct Integration)
// =============================================================================

const OLLAMA_URL = process.env.NEXT_PUBLIC_OLLAMA_URL || 'http://localhost:11434';

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    format?: string;
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  system?: string;
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
  };
}

export interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
  };
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/** List available Ollama models */
export async function ollamaListModels(): Promise<ApiResult<{ models: OllamaModel[] }>> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) {
      return { data: null, error: `Ollama API error: ${res.status}`, status: res.status };
    }
    const data = await res.json();
    return { data, error: null, status: res.status };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Failed to connect to Ollama',
      status: 0
    };
  }
}

/** Generate completion with Ollama */
export async function ollamaGenerate(request: OllamaGenerateRequest): Promise<ApiResult<OllamaGenerateResponse>> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: false }),
    });
    if (!res.ok) {
      return { data: null, error: `Ollama generate error: ${res.status}`, status: res.status };
    }
    const data = await res.json();
    return { data, error: null, status: res.status };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Ollama generate failed',
      status: 0
    };
  }
}

/** Chat with Ollama model */
export async function ollamaChat(request: OllamaChatRequest): Promise<ApiResult<OllamaChatResponse>> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: false }),
    });
    if (!res.ok) {
      return { data: null, error: `Ollama chat error: ${res.status}`, status: res.status };
    }
    const data = await res.json();
    return { data, error: null, status: res.status };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Ollama chat failed',
      status: 0
    };
  }
}

/** Check Ollama service health */
export async function ollamaHealth(): Promise<ApiResult<{ status: string; version?: string }>> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/version`);
    if (!res.ok) {
      return { data: null, error: `Ollama not available: ${res.status}`, status: res.status };
    }
    const data = await res.json();
    return { data: { status: 'healthy', version: data.version }, error: null, status: res.status };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Ollama not running',
      status: 0
    };
  }
}
