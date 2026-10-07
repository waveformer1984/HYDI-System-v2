#!/usr/bin/env node
// ProtoForge MCP server.
//
//   node src/server.js          stdio — for Claude Code / Claude Desktop on Frank
//   node src/server.js --http   Streamable HTTP on PROTOFORGE_MCP_HOST:PORT
//                               (default 127.0.0.1:3470) — put it behind
//                               `tailscale serve` to reach it from the phone.
//
// HTTP mode refuses to start without PROTOFORGE_MCP_TOKEN, and every request
// must carry `Authorization: Bearer <token>`.

import http from 'node:http';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { timingSafeEqual, createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadEnvFiles, readConfig } from './config.js';
import { registerAll } from './tools.js';

const VERSION = '0.1.0';
const log = (...a) => console.error('[protoforge-mcp]', ...a); // stdout belongs to stdio JSON-RPC

export function buildServer(ctx) {
  const server = new McpServer(
    { name: 'protoforge', version: VERSION },
    {
      instructions:
        'ProtoForge Industries operations tools (HYDI/Heidi on Frank, Supabase, Stripe). All tools in this version are read-only. ' +
        'Start with system_health; use mobile_status for a business snapshot and pending_approvals for anything awaiting a human decision.',
    },
  );
  const names = registerAll(server, ctx);
  return { server, names };
}

/** Constant-time bearer check (hash both sides so lengths always match). */
export function bearerOk(header, token) {
  if (!token || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const a = createHash('sha256').update(header.slice(7)).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
}

async function readJson(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('payload too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function createHttpHandler(ctx) {
  return async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/healthz' && req.method === 'GET') return sendJson(res, 200, { ok: true, name: 'protoforge-mcp', version: VERSION });
    if (url.pathname !== '/mcp') return sendJson(res, 404, { error: 'not found' });
    if (!bearerOk(req.headers.authorization, ctx.cfg.httpToken)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return sendJson(res, 401, { error: 'unauthorized' });
    }
    // Stateless mode: no server-initiated streams, so only POST is served.
    if (req.method !== 'POST') return sendJson(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });

    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendJson(res, err.statusCode || 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
    }

    const { server } = buildServer(ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      log('request failed:', err instanceof Error ? err.message : err);
      if (!res.headersSent) sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  };
}

async function main() {
  await loadEnvFiles();
  const cfg = readConfig();
  const ctx = { cfg, deps: {} };

  if (process.argv.includes('--http')) {
    if (!cfg.httpToken) {
      log('PROTOFORGE_MCP_TOKEN is not set — refusing to start the HTTP transport unauthenticated.');
      process.exit(1);
    }
    const httpServer = http.createServer(createHttpHandler(ctx));
    httpServer.listen(cfg.httpPort, cfg.httpHost, () => {
      log(`v${VERSION} listening on http://${cfg.httpHost}:${cfg.httpPort}/mcp (tools: ${buildServer(ctx).names.join(', ')})`);
    });
    const stop = () => httpServer.close(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return;
  }

  const { server, names } = buildServer(ctx);
  await server.connect(new StdioServerTransport());
  log(`v${VERSION} ready on stdio (tools: ${names.join(', ')})`);
}

// Run main() only when executed (not when imported by tests). pathToFileURL
// keeps this correct for Windows paths on Frank.
const entry = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (entry && (import.meta.url === pathToFileURL(entry).href || /protoforge-mcp(\.cmd)?$/.test(entry))) {
  main().catch((err) => {
    log('fatal:', err instanceof Error ? err.stack : err);
    process.exit(1);
  });
}
