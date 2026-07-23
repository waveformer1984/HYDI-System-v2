import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { appendHydiTask } from '@/lib/hydi-task-store';
import { toStorageTaskStatus } from '@/lib/task-status';
import type { UDPTaskCore } from '@/types/task';

interface HYDIRequest {
  message: string;
  context?: {
    user?: string;
    [key: string]: unknown;
  };
}

interface HYDIResponse {
  intent: string;
  confidence: number;
  task_id?: string;
  task_status?: "queued" | "running" | "completed" | "failed_terminal";
  response: string;
}

// Request deduplication
const recentRequests = new Map<string, number>();
const REQUEST_DEDUP_WINDOW = 5000; // 5 seconds

// Mock counters for compatibility
const counters = {
  requests_total: 0,
  requests_success: 0,
  requests_failed: 0,
  midi_files_generated: 0,
  duplicate_requests_blocked: 0,
  source: 'ursula-api',
  processId: process.pid,
  last_updated: new Date().toISOString()
};

// Mock functions for compatibility
async function incrementDuplicateBlocked(): Promise<void> {
  counters.duplicate_requests_blocked++;
}

async function incrementRequest(success: boolean): Promise<void> {
  counters.requests_total++;
  if (success) {
    counters.requests_success++;
  } else {
    counters.requests_failed++;
  }
}

function getCounters(): typeof counters {
  return { ...counters };
}

function isDuplicateRequest(user: string, message: string): boolean {
  const key = `${user}:${message.toLowerCase().trim()}`;
  const now = Date.now();
  const lastRequest = recentRequests.get(key);

  if (lastRequest && (now - lastRequest) < REQUEST_DEDUP_WINDOW) {
    return true;
  }

  recentRequests.set(key, now);

  // Cleanup old entries
  for (const [reqKey, timestamp] of recentRequests.entries()) {
    if (now - timestamp > REQUEST_DEDUP_WINDOW * 2) {
      recentRequests.delete(reqKey);
    }
  }

  return false;
}

// ── LLM intent classification ─────────────────────────────────────────────────

interface ClassifiedIntent {
  intent: string;
  confidence: number;
  task_type: string;
  priority: number;
  response_hint: string;
}

async function classifyWithLLM(message: string): Promise<ClassifiedIntent> {
  const { inferJSON } = await import('@/lib/inference-router');

  const { data } = await inferJSON<ClassifiedIntent>(
    `User message: "${message}"`,
    {
      system: `You are Heidi, the intent classifier for ProtoForge's HYDI system.
Classify the user message and respond ONLY with JSON:
{
  "intent": "one of: build_feature | fix_bug | deploy_service | analyze_system | integrate_service | follow_up | schedule_task | general_task",
  "confidence": 0.0-1.0,
  "task_type": "one of: feature | bug | research | task | documentation",
  "priority": 1-10,
  "response_hint": "one sentence confirming what you understood"
}`,
    }
  );

  // Validated fallback if LLM fails or returns bad JSON
  if (!data || typeof data.intent !== 'string') {
    return fallbackClassify(message);
  }

  return {
    intent: data.intent,
    confidence: typeof data.confidence === 'number' ? data.confidence : 0.75,
    task_type: data.task_type ?? 'task',
    priority: typeof data.priority === 'number' ? Math.min(10, Math.max(1, data.priority)) : 5,
    response_hint: data.response_hint ?? `Working on: ${message}`,
  };
}

function fallbackClassify(message: string): ClassifiedIntent {
  const m = message.toLowerCase();
  if (/build|create|develop|implement/.test(m)) return { intent: 'build_feature', confidence: 0.8, task_type: 'feature', priority: 7, response_hint: `Building: ${message}` };
  if (/fix|bug|broken|error/.test(m))           return { intent: 'fix_bug',       confidence: 0.85, task_type: 'bug',     priority: 8, response_hint: `Fixing: ${message}` };
  if (/deploy|launch|release/.test(m))          return { intent: 'deploy_service', confidence: 0.8, task_type: 'task',    priority: 9, response_hint: `Deploying: ${message}` };
  if (/follow.?up|client/.test(m))              return { intent: 'follow_up',      confidence: 0.9, task_type: 'task',    priority: 6, response_hint: `Following up: ${message}` };
  return { intent: 'general_task', confidence: 0.7, task_type: 'task', priority: 5, response_hint: `Processing: ${message}` };
}

// ── Submit to project-ops queue ───────────────────────────────────────────────

async function submitToQueue(
  message: string,
  classified: ClassifiedIntent,
  user: string,
  taskId: string
): Promise<boolean> {
  const projectOpsUrl = process.env.PROJECT_OPS_URL ?? 'http://localhost:3100';
  try {
    const res = await fetch(`${projectOpsUrl}/api/intake/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: message.length <= 80 ? message : message.slice(0, 77) + '...',
        description: message,
        task_type: classified.task_type,
        priority: classified.priority * 10, // queue uses 1-100
        requested_by: `ursula:${user}:${taskId}`,
        input_payload: { source: 'ursula-chat', intent: classified.intent, user },
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── HYDI BRIDGE EXECUTOR ──────────────────────────────────────────────────────

async function executeAction(message: string, context: HYDIRequest['context']): Promise<HYDIResponse> {
  const user = context?.user || "default";

  if (isDuplicateRequest(user, message)) {
    await incrementDuplicateBlocked();
    return { intent: "duplicate_request", confidence: 0.0, response: "Already processing — please wait." };
  }

  const taskId = randomUUID();
  const now = new Date().toISOString();

  // LLM classification (Ollama → OpenVINO → Claude)
  const classified = await classifyWithLLM(message);
  console.log(`[HYDI-CHAT] intent=${classified.intent} confidence=${classified.confidence} provider=inference-router`);

  // Save to Ursula task store
  const taskData: UDPTaskCore = {
    task_id: taskId,
    source: 'heidi' as const,
    system: 'general' as const,
    type: 'research' as const,
    title: `[HYDI] ${classified.intent.replaceAll('_', ' ')}: ${message.slice(0, 60)}`,
    description: message,
    inputs: { message, user, context: context || {}, intent: classified.intent, confidence: classified.confidence },
    outputs_expected: { summary: 'Execution summary' },
    dependencies: [],
    priority: classified.priority,
    urgency: classified.priority,
    revenue_impact: { stage: 'partial' as const, value: 10 },
    status: toStorageTaskStatus('queued'),
    retry_count: 0,
    created_at: now,
    updated_at: now,
    state_version: 1,
  };

  try {
    await appendHydiTask(taskData);
  } catch (e) {
    console.error('[HYDI-CHAT] Failed to store task:', e);
    return { intent: 'error', confidence: 0, task_status: 'failed_terminal', response: 'Failed to create task' };
  }

  // Also submit to persistent Supabase queue (best-effort, non-blocking)
  submitToQueue(message, classified, user, taskId).then((ok) => {
    if (ok) console.log(`[HYDI-CHAT] Queued in project-ops: ${taskId}`);
  }).catch(() => {});

  return {
    intent: classified.intent,
    confidence: classified.confidence,
    task_id: taskId,
    task_status: 'queued',
    response: classified.response_hint,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId =
    request.headers.get('x-trace-id') ||
    request.headers.get('x-request-id') ||
    randomUUID();
  try {
    const body: HYDIRequest = await request.json();
    const { message, context } = body;

    if (!message || !context) {
      await incrementRequest(false);
      return NextResponse.json(
        { error: 'Missing required fields: message, context', traceId },
        { status: 400, headers: { 'x-trace-id': traceId } }
      );
    }

    // Execute the action immediately
    const result = await executeAction(message, context);

    // SINGLE INCREMENT POINT: Only increment once at the end
    await incrementRequest(true);

    return NextResponse.json(
      { ...result, traceId },
      { headers: { 'x-trace-id': traceId } }
    );

  } catch (error) {
    await incrementRequest(false);
    return NextResponse.json(
      {
        response: 'I encountered an error processing your request.',
        intent: 'error',
        confidence: 0.0,
        task_status: 'failed_terminal',
        traceId,
      },
      { status: 500, headers: { 'x-trace-id': traceId } }
    );
  }
}

export async function GET(): Promise<NextResponse> {
  const counters = getCounters();

  return NextResponse.json({
    service: 'hydi-chat',
    status: 'active',
    metrics: {
      counters: {
        requests_total: counters.requests_total,
        requests_success: counters.requests_success,
        requests_failed: counters.requests_failed,
        midi_files_generated: counters.midi_files_generated,
        duplicate_requests_blocked: counters.duplicate_requests_blocked,
      },
      source: counters.source,
      processId: counters.processId,
      last_updated: counters.last_updated
    }
  });
}
