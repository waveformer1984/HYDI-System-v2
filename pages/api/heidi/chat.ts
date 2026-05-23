import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { callAgent, isClaudeAvailable } from '../../../lib/claude';

const MEMORY_LIMIT = 12;

function getSupabase() {
  return createClient(
    (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function retrieveSessionMemory(sessionId: string): Promise<string> {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('memories')
      .select('content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(MEMORY_LIMIT);

    if (!data || data.length === 0) return '';
    return data
      .reverse()
      .map((m: { content: string }) => m.content)
      .join('\n');
  } catch {
    return '';
  }
}

async function storeMemory(
  sessionId: string,
  userId: string,
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  try {
    const supabase = getSupabase();
    const now = Date.now();
    const zeroVec = new Array(1536).fill(0);
    await supabase.from('memories').insert([
      {
        user_id: userId,
        session_id: sessionId,
        content: `User: ${userMessage}`,
        embedding: zeroVec,
        created_at: new Date(now).toISOString(),
      },
      {
        user_id: userId,
        session_id: sessionId,
        content: `Heidi: ${assistantResponse}`,
        embedding: zeroVec,
        created_at: new Date(now + 1).toISOString(),
      },
    ]);
  } catch {
    // Memory storage is non-critical
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, session_id, user_id = 'default-user' } = req.body as {
    message?: string;
    session_id?: string;
    user_id?: string;
  };

  if (!message) return res.status(400).json({ error: 'message required' });
  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  const start = Date.now();

  const memoryContext = await retrieveSessionMemory(session_id);
  const context = memoryContext ? `Recent conversation:\n${memoryContext}` : undefined;

  let response: string;
  let modelUsed: string;

  if (isClaudeAvailable()) {
    try {
      response = await callAgent('heidi', message, context);
      modelUsed = 'claude-haiku';
    } catch (err) {
      response = `I'm having trouble connecting right now. ${err instanceof Error ? err.message : 'Please try again.'}`;
      modelUsed = 'error';
    }
  } else {
    response = 'ANTHROPIC_API_KEY is not configured. Add it to your environment to enable Heidi.';
    modelUsed = 'unconfigured';
  }

  storeMemory(session_id, user_id, message, response).catch(() => {});

  return res.status(200).json({
    response,
    model_used: modelUsed,
    latency: Date.now() - start,
    session_state: {
      session_id,
      active_model: isClaudeAvailable() ? 'api' : 'fallback',
      tone: 'neutral',
      last_action_status: 'success',
    },
  });
}
