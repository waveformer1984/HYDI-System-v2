import { parseSSEData } from '../../lib/useHeidiChat';

describe('Heidi chat SSE parsing', () => {
  it('parses a content event', () => {
    const data = parseSSEData('data: {"type":"content","content":"hello"}');
    expect(data).toEqual({ type: 'content', content: 'hello' });
  });

  it('parses a metadata event', () => {
    const data = parseSSEData('data: {"type":"metadata","model_used":"mock"}');
    expect(data).toEqual({ type: 'metadata', model_used: 'mock' });
  });

  it('parses a tool event', () => {
    const data = parseSSEData('data: {"type":"tool","tool":{"type":"fetch","status":"completed"}}');
    expect(data).toEqual({ type: 'tool', tool: { type: 'fetch', status: 'completed' } });
  });

  it('returns null for [DONE]', () => {
    expect(parseSSEData('data: [DONE]')).toBeNull();
  });

  it('returns null for non-data lines', () => {
    expect(parseSSEData(': keep-alive')).toBeNull();
    expect(parseSSEData('event: message')).toBeNull();
    expect(parseSSEData('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseSSEData('data: {not-json}')).toBeNull();
  });
});
