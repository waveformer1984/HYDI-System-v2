/**
 * Reads heidi-core's /chat-tools stream: `data: {json}\n\n` events carrying
 * `{ t }` text chunks, then `{ done, conversation_id, ... }`, or `{ error }`.
 * Chunks can split an event anywhere, so callers keep the returned `rest`.
 */

export interface HeidiEvent {
  t?: string;
  done?: boolean;
  error?: string;
  conversation_id?: string | null;
  conversation_not_found?: boolean;
  model?: string;
  [key: string]: unknown;
}

export function parseSse(buffer: string): { events: HeidiEvent[]; rest: string } {
  const events: HeidiEvent[] = [];
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    for (const line of part.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try {
        events.push(JSON.parse(line.slice(6)) as HeidiEvent);
      } catch {
        // A malformed event is skipped, never fatal to the rest of the reply.
      }
    }
  }
  return { events, rest };
}

/** Tool progress lines heidi-core sends while it works ("⚙️ run_command…"). */
export function splitToolLines(text: string): { tools: string[]; answer: string } {
  const tools: string[] = [];
  const answer: string[] = [];
  for (const line of text.split('\n')) {
    if (/^⚙️ \S+…$/.test(line.trim())) tools.push(line.trim().slice(3, -1));
    else answer.push(line);
  }
  return { tools, answer: answer.join('\n').trim() };
}
