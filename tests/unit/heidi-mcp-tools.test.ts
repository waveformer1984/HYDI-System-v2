/**
 * Unit tests for the ProtoForge MCP read path:
 *
 *   lib/protoforge-mcp-client.ts — the stateless tools/call client
 *   lib/action-executor.ts       — mcpRead dispatch for the four read tools
 *   lib/governance/ActionChokepoint.ts — R0 classification
 *
 * The four tools are the single canonical read surface for system health,
 * the mobile snapshot, pending approvals, and autonomy bounds — they must
 * never fall back to duplicated logic, and a dead MCP server must be an
 * honest failure, never a fabricated status.
 */

import { callProtoforgeTool } from '../../lib/protoforge-mcp-client';
import { ActionExecutor } from '../../lib/action-executor';
import { evaluateAction, ACTION_RISK } from '../../lib/governance/ActionChokepoint';

const MCP_READ_TOOLS = ['system_health', 'mobile_status', 'pending_approvals', 'decision_bounds'];

function mcpResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
    }),
  } as unknown as Response;
}

describe('callProtoforgeTool', () => {
  const originalToken = process.env.PROTOFORGE_MCP_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.PROTOFORGE_MCP_TOKEN;
    else process.env.PROTOFORGE_MCP_TOKEN = originalToken;
  });

  it('fails honestly when no token is configured', async () => {
    delete process.env.PROTOFORGE_MCP_TOKEN;
    const res = await callProtoforgeTool('system_health');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('PROTOFORGE_MCP_TOKEN');
  });

  it('POSTs a bearer-authenticated tools/call to <base>/mcp', async () => {
    const fetchImpl = jest.fn(async () => mcpResponse({ ok: true, data: { services: 3 } }));
    const res = await callProtoforgeTool('system_health', {}, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      url: 'http://127.0.0.1:9999/',
      token: 'tok',
    });
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ services: 3 });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:9999/mcp');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    const body = JSON.parse(init.body as string);
    expect(body.method).toBe('tools/call');
    expect(body.params).toEqual({ name: 'system_health', arguments: {} });
  });

  it('passes tool arguments through', async () => {
    const fetchImpl = jest.fn(async () => mcpResponse({ ok: true, data: [] }));
    await callProtoforgeTool('pending_approvals', { limit: 5 }, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      url: 'http://x', token: 't',
    });
    const init = (fetchImpl.mock.calls[0] as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string).params.arguments).toEqual({ limit: 5 });
  });

  it('surfaces a 401 as an auth failure', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) } as Response));
    const res = await callProtoforgeTool('system_health', {}, {
      fetchImpl: fetchImpl as unknown as typeof fetch, url: 'http://x', token: 'bad',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('401');
  });

  it('surfaces non-200 HTTP as a failure', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) } as Response));
    const res = await callProtoforgeTool('mobile_status', {}, {
      fetchImpl: fetchImpl as unknown as typeof fetch, url: 'http://x', token: 't',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('500');
  });

  it('surfaces JSON-RPC-level errors', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ error: { message: 'Method not found' } }),
    } as Response));
    const res = await callProtoforgeTool('nope', {}, {
      fetchImpl: fetchImpl as unknown as typeof fetch, url: 'http://x', token: 't',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Method not found');
  });

  it('surfaces tool-level { ok:false } payloads as failures', async () => {
    const fetchImpl = jest.fn(async () => mcpResponse({ ok: false, error: 'supabase unreachable' }));
    const res = await callProtoforgeTool('decision_bounds', {}, {
      fetchImpl: fetchImpl as unknown as typeof fetch, url: 'http://x', token: 't',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('supabase unreachable');
  });

  it('never throws when the server is unreachable', async () => {
    const fetchImpl = jest.fn(async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); });
    const res = await callProtoforgeTool('system_health', {}, {
      fetchImpl: fetchImpl as unknown as typeof fetch, url: 'http://x', token: 't',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('ECONNREFUSED');
  });

  it('reports timeouts as failures', async () => {
    const fetchImpl = jest.fn(async (_u: unknown, init?: RequestInit) => {
      await new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
      return mcpResponse({});
    });
    const res = await callProtoforgeTool('system_health', {}, {
      fetchImpl: fetchImpl as unknown as typeof fetch, url: 'http://x', token: 't', timeoutMs: 20,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('timed out');
  });
});

describe('ActionExecutor MCP read dispatch', () => {
  // Minimal supabase stub — the MCP path must never touch it.
  const supabase = {} as ConstructorParameters<typeof ActionExecutor>[0];
  const executor = new ActionExecutor(supabase);

  for (const tool of MCP_READ_TOOLS) {
    it(`${tool} is classified R0 (autonomous read)`, () => {
      expect(ACTION_RISK[tool]).toBe('R0');
      const d = evaluateAction({ type: tool, requester: 'test' });
      expect(d.allowed).toBe(true);
    });
  }

  it('delegates the four tools to the MCP server and returns its payload', async () => {
    const fetchImpl = jest.fn(async () => mcpResponse({ ok: true, data: { degraded: false } }));
    const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(fetchImpl as unknown as typeof fetch);
    process.env.PROTOFORGE_MCP_TOKEN = 'tok';
    try {
      for (const tool of MCP_READ_TOOLS) {
        const res = await executor.execute({ type: tool, payload: {} }, 'sess-1');
        expect(res.status).toBe('completed');
        expect(res.result).toEqual({ degraded: false });
      }
      expect(fetchImpl).toHaveBeenCalledTimes(MCP_READ_TOOLS.length);
    } finally {
      spy.mockRestore();
      delete process.env.PROTOFORGE_MCP_TOKEN;
    }
  });

  it('fails honestly when the MCP server is down — no fabricated status', async () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('fetch failed');
    });
    process.env.PROTOFORGE_MCP_TOKEN = 'tok';
    try {
      const res = await executor.execute({ type: 'system_health', payload: {} }, 'sess-1');
      expect(res.status).toBe('failed');
      expect(res.error).toBeTruthy();
      expect(res.result).toBeUndefined();
    } finally {
      spy.mockRestore();
      delete process.env.PROTOFORGE_MCP_TOKEN;
    }
  });
});
