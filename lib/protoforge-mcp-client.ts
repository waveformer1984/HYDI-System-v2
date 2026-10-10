/**
 * PROTOFORGE MCP CLIENT
 *
 * Thin JSON-RPC client for the ProtoForge MCP server (mcp/protoforge-mcp).
 * Heidi's read tools delegate to it instead of duplicating the reads the
 * server already computes (per-service health probes, the mobile-status
 * snapshot, pending-approval listing, autonomy bounds).
 *
 * The HTTP transport is stateless — a bare `tools/call` POST works without an
 * initialize handshake. Auth is a bearer token (PROTOFORGE_MCP_TOKEN), minted
 * by scripts/tailscale/serve-mcp.ps1 into .env.local.
 *
 * Read-only by construction: this client only exposes `tools/call`. It never
 * throws — a dead MCP server degrades the one tool that needed it, never the
 * executor, and never fabricates a result.
 */

export interface McpCallResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface McpClientDeps {
  fetchImpl?: typeof fetch;
  url?: string;
  token?: string;
  timeoutMs?: number;
}

const DEFAULT_URL = 'http://127.0.0.1:3470';
const DEFAULT_TIMEOUT_MS = 8000;

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown error';
  const cause = (err as { cause?: { code?: string } }).cause;
  return cause && cause.code ? `${cause.code} (${err.message})` : err.message;
}

/**
 * Call a protoforge MCP tool. Returns the parsed payload the tool emitted
 * (the JSON inside `result.content[0].text`), or an honest error.
 */
export async function callProtoforgeTool(
  name: string,
  args: Record<string, unknown> = {},
  deps: McpClientDeps = {},
): Promise<McpCallResult> {
  const token = deps.token ?? process.env.PROTOFORGE_MCP_TOKEN;
  if (!token) {
    return { ok: false, error: 'PROTOFORGE_MCP_TOKEN is not set — the MCP read path is unconfigured' };
  }
  const base = (deps.url ?? process.env.PROTOFORGE_MCP_URL ?? DEFAULT_URL).replace(/\/+$/, '');
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      signal: controller.signal,
    });

    if (res.status === 401) {
      return { ok: false, error: 'MCP rejected the bearer token (401)' };
    }
    if (!res.ok) {
      return { ok: false, error: `MCP HTTP ${res.status}` };
    }

    const body = (await res.json()) as {
      result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
      error?: { message?: string };
    };
    if (body.error) {
      return { ok: false, error: `MCP error: ${body.error.message || 'unknown'}` };
    }
    const text = body.result?.content?.find((c) => c.type === 'text')?.text;
    if (body.result?.isError || text === undefined) {
      return { ok: false, error: text || 'MCP returned an error without detail' };
    }
    try {
      const parsed = JSON.parse(text) as { ok?: boolean; data?: unknown; error?: string; status?: number };
      if (parsed && parsed.ok === false) {
        return { ok: false, error: parsed.error || `MCP tool ${name} reported failure` };
      }
      return { ok: true, data: parsed && 'data' in parsed ? parsed.data : parsed };
    } catch {
      return { ok: true, data: text };
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, error: aborted ? `MCP timed out after ${timeoutMs}ms` : describeError(err) };
  } finally {
    clearTimeout(timer);
  }
}
