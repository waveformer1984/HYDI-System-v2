'use strict';

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../../hydi-mobile-protoforge.html'), 'utf8');

function extractFunction(src, name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error('missing function ' + name);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unclosed function ' + name);
}

const page = new Function(
  `${extractFunction(html, 'chatReplyFromHttp')}
   ${extractFunction(html, 'buildOfflineReply')}
   ${extractFunction(html, 'wsReconnectPlan')}
   return { chatReplyFromHttp, buildOfflineReply, wsReconnectPlan };`
)();

describe('hydi mobile chat against hydi.py JSON', () => {
  it('shows a JSON /api/chat body instead of the canned offline line', () => {
    const raw = JSON.stringify({
      response: 'Hello from the phone model',
      system: 'hydi',
      model: 'qwen2.5-1.5b',
    });
    const parsed = page.chatReplyFromHttp('application/json; charset=utf-8', raw);
    expect(parsed).toEqual({
      kind: 'json',
      text: 'Hello from the phone model',
      model: 'qwen2.5-1.5b',
      empty: false,
      error: null,
    });
    expect(raw.includes('data: ')).toBe(false);
    expect(html).toMatch(/chatReplyFromHttp\(r\.headers\.get\('content-type'\)/);
  });

  it('still reads the Next.js SSE stream', () => {
    const sse = 'data: {"type":"content","content":"from next"}\n\ndata: [DONE]\n\n';
    expect(page.chatReplyFromHttp('text/event-stream', sse)).toMatchObject({
      kind: 'sse',
      text: 'from next',
      empty: false,
    });
  });

  it('treats an empty payload as empty and a failed shape as empty', () => {
    expect(page.chatReplyFromHttp('application/json', '{"response":"  "}').empty).toBe(true);
    expect(page.chatReplyFromHttp('application/json', 'not-json').empty).toBe(true);
  });

  it('never claims an offline command was queued or sent', () => {
    const prompts = ['status', 'grow outreach', 'scale', 'agents', 'revenue', 'approvals', 'hello'];
    for (const prompt of prompts) {
      const reply = page.buildOfflineReply(prompt);
      expect(reply).toContain('Offline — this command was NOT sent');
      expect(reply.toLowerCase()).not.toMatch(/\bqueued\b/);
      expect(reply.toLowerCase()).not.toMatch(/\bexecute/);
      expect(reply.toLowerCase()).not.toMatch(/\bdeploy/);
      expect(reply.replace(/NOT sent/g, '')).not.toMatch(/sent/i);
    }
    expect(html).not.toMatch(/Growth command queued/);
  });

  it('keeps the HTTP health badge online and stops websocket retries after 3 misses', () => {
    expect(page.wsReconnectPlan(1, true)).toEqual({
      gaveUp: false,
      retry: true,
      showOfflineBanner: false,
    });
    expect(page.wsReconnectPlan(3, true)).toEqual({
      gaveUp: true,
      retry: false,
      showOfflineBanner: false,
    });
    expect(page.wsReconnectPlan(3, false).showOfflineBanner).toBe(true);
    expect(html).toMatch(/STATE\.httpOnline = true/);
    expect(html).toMatch(/if \(STATE\.wsGaveUp\) return/);
  });
});
