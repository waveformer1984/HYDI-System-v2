/**
 * HEIDI AGENT (streaming, tool-using)
 *
 * The unified Heidi brain: retrieves memory, runs an Anthropic tool-use loop
 * with native tool calling (no JSON-in-text parsing), executes tools for real
 * via ActionExecutor, streams assistant text token-by-token, and persists the
 * conversation to memory.
 *
 * Requires ANTHROPIC_API_KEY. Callers should check `isClaudeAvailable()` and
 * fall back to the legacy orchestrator when it is not configured.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { getAnthropicClient, getAgentSystemPrompt } from './claude';
import { ActionExecutor, ExecutorAction, ActionResult } from './action-executor';
import { HEIDI_TOOLS } from './heidi-tools';
import { retrieveMemory, storeMemory } from './heidi-memory';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = 2048;
const MAX_TOOL_ITERATIONS = 6;

export interface AgentToolEvent {
  type: string;
  status: ActionResult['status'];
  result?: unknown;
  error?: string;
}

export interface RunHeidiAgentParams {
  message: string;
  sessionId: string;
  userId: string;
  onText: (delta: string) => void;
  onTool?: (event: AgentToolEvent) => void;
}

export interface RunHeidiAgentResult {
  text: string;
  actions: AgentToolEvent[];
  model: string;
}

/**
 * Run the streaming, tool-using Heidi agent loop.
 */
export async function runHeidiAgentStream(params: RunHeidiAgentParams): Promise<RunHeidiAgentResult> {
  const { message, sessionId, userId, onText, onTool } = params;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const executor = new ActionExecutor(supabase);
  const client = getAnthropicClient();

  const memoryContext = await retrieveMemory(supabase, message, userId);
  const system = [
    getAgentSystemPrompt('heidi'),
    'You can take real actions using the provided tools. Prefer tools over describing what you would do. Read data with fetch_data before answering data questions.',
    memoryContext,
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: message }];
  const executedActions: AgentToolEvent[] = [];
  let fullText = '';

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: HEIDI_TOOLS,
      messages,
    });

    stream.on('text', (delta: string) => {
      fullText += delta;
      onText(delta);
    });

    const final = await stream.finalMessage();
    messages.push({ role: 'assistant', content: final.content });

    const toolUses = final.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (toolUses.length === 0) {
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      const action: ExecutorAction = {
        type: toolUse.name,
        payload: (toolUse.input ?? {}) as Record<string, unknown>,
      };
      const outcome = await executor.execute(action, sessionId);

      const event: AgentToolEvent = {
        type: toolUse.name,
        status: outcome.status,
        result: outcome.result,
        error: outcome.error,
      };
      executedActions.push(event);
      onTool?.(event);

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(outcome.result ?? outcome.error ?? outcome.status),
        is_error: outcome.status === 'failed',
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  await storeMemory(supabase, sessionId, userId, message, fullText);

  return { text: fullText, actions: executedActions, model: MODEL };
}
