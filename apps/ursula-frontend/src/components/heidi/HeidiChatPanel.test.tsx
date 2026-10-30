import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HeidiChatPanel from './HeidiChatPanel';

function sseResponse(events: object[]) {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('HeidiChatPanel', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    window.localStorage.clear();
    fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/heidi/health') return Response.json({ ok: true, status: 200 });
      if (url === '/api/heidi/chat') return sseResponse([{ t: '⚙️ list_missions…\n' }, { t: 'Nothing waiting.' }, { done: true, conversation_id: 'c-9' }]);
      if (url.startsWith('/api/heidi/conversations/')) return Response.json({ messages: [{ id: 1, role: 'user', content: 'earlier question' }, { id: 2, role: 'assistant', content: 'earlier answer' }] });
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    Element.prototype.scrollTo = () => {};
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is open by default, sends, streams the answer and remembers the conversation', async () => {
    render(<HeidiChatPanel />);
    expect(await screen.findByTestId('heidi-panel')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('online')).toBeTruthy());
    fireEvent.change(screen.getByTestId('heidi-panel-input'), { target: { value: 'tasks' } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('heidi-panel-input'), { key: 'Enter' }); });
    expect(await screen.findByText('Nothing waiting.')).toBeTruthy();
    expect(screen.getByText('⚙ list_missions')).toBeTruthy();
    expect(window.localStorage.getItem('ursula.heidiPanel.conversationId')).toBe('c-9');
    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[0] === '/api/heidi/chat')![1].body);
    expect(body).toMatchObject({ message: 'tasks', conversation_id: null });
  });

  it('closes to a corner button, and stays closed across reloads until reopened', async () => {
    const first = render(<HeidiChatPanel />);
    fireEvent.click(await screen.findByTestId('heidi-panel-close'));
    expect(screen.getByTestId('heidi-panel-open')).toBeTruthy();
    expect(window.localStorage.getItem('ursula.heidiPanel.open')).toBe('false');
    first.unmount();
    render(<HeidiChatPanel />);
    fireEvent.click(await screen.findByTestId('heidi-panel-open'));
    expect(await screen.findByTestId('heidi-panel')).toBeTruthy();
  });

  it('reloads the remembered conversation, and explains a local-only refusal', async () => {
    window.localStorage.setItem('ursula.heidiPanel.conversationId', 'c-9');
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/heidi/chat') return Response.json({ error: 'local_only', hint: 'The Heidi panel only works from Ursula on this PC.' }, { status: 403 });
      if (url.startsWith('/api/heidi/conversations/c-9')) return Response.json({ messages: [{ id: 1, role: 'user', content: 'earlier question' }, { id: 2, role: 'assistant', content: 'earlier answer' }] });
      return Response.json({ ok: false });
    });
    render(<HeidiChatPanel />);
    expect(await screen.findByText('earlier answer')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('not answering')).toBeTruthy());
    fireEvent.change(screen.getByTestId('heidi-panel-input'), { target: { value: 'hi' } });
    await act(async () => { fireEvent.submit(screen.getByTestId('heidi-panel-input').closest('form')!); });
    expect(await screen.findByText('The Heidi panel only works from Ursula on this PC.')).toBeTruthy();
  });
});
