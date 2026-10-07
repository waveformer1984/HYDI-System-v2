// End-to-end over the HTTP transport with the real MCP client.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readConfig } from '../src/config.js';
import { createHttpHandler, bearerOk } from '../src/server.js';

let srv;
let base;

before(async () => {
  const cfg = readConfig({ PROTOFORGE_MCP_TOKEN: 'tok', HYDI_SERVICE_SECRET: 's' });
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) });
  srv = http.createServer(createHttpHandler({ cfg, deps: { fetchImpl } }));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => new Promise((r) => srv.close(r)));

test('bearerOk is exact', () => {
  assert.equal(bearerOk('Bearer tok', 'tok'), true);
  assert.equal(bearerOk('Bearer tok2', 'tok'), false);
  assert.equal(bearerOk('tok', 'tok'), false);
  assert.equal(bearerOk('Bearer tok', undefined), false);
});

test('rejects requests without the bearer token', async () => {
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 401);
});

test('healthz is open and minimal', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).name, 'protoforge-mcp');
});

test('an MCP client can list and call tools', async () => {
  const client = new Client({ name: 'test', version: '0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: 'Bearer tok' } },
  });
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.ok(names.includes('system_health') && names.includes('pending_approvals'), names.join(','));
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));

  const result = await client.callTool({ name: 'mobile_status', arguments: {} });
  assert.equal(result.isError, false);
  assert.deepEqual(JSON.parse(result.content[0].text), { ok: true, data: { ok: true } });
  await client.close();
});
