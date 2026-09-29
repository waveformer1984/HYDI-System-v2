/**
 * Incremental Server-Sent Events parser, shared by the Heidi Mobile server
 * relays (pages/api/heidi-mobile/chat.js, events.js) and the phone client
 * (lib/heidi-mobile/client/api.ts). Feed it arbitrary network chunks; it
 * emits one callback per complete event, tolerating CRLF line endings,
 * multi-line data fields, comments, and events split across chunks.
 */

export interface SseEvent {
  event: string;
  data: string;
  id: string | null;
}

export interface SseParser {
  push: (_chunk: string) => void;
  flush: () => void;
}

const MAX_BUFFER = 1024 * 1024; // refuse to buffer more than 1 MiB of an unterminated event

export function createSseParser(onEvent: (_event: SseEvent) => void): SseParser {
  let buffer = '';

  function dispatch(block: string) {
    let event = 'message';
    let id: string | null = null;
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const idx = line.indexOf(':');
      const field = idx === -1 ? line : line.slice(0, idx);
      let value = idx === -1 ? '' : line.slice(idx + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      else if (field === 'event') event = value || 'message';
      else if (field === 'id') id = value;
    }
    if (data.length) onEvent({ event, data: data.join('\n'), id });
  }

  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n?/g, '\n');
      if (buffer.length > MAX_BUFFER) {
        buffer = '';
        throw new Error('SSE event exceeded maximum size');
      }
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        dispatch(block);
        idx = buffer.indexOf('\n\n');
      }
    },
    flush() {
      if (buffer.trim()) dispatch(buffer);
      buffer = '';
    },
  };
}

/** Parse an SSE data field as JSON, returning undefined (not throwing) when it isn't. */
export function parseJsonData(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}
