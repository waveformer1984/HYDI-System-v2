#!/usr/bin/env node
// End-to-end smoke test for HYDI /api/chat infrastructure handler.
// Generates real HMAC-SHA256 service tokens and exercises all infra commands.
//
// Usage:
//   HYDI_URL=https://your-hydi.vercel.app \
//   HYDI_SERVICE_SECRET=your-secret \
//   node scripts/smoke-test.js

import { createHmac } from 'crypto'

const HYDI_URL = process.env.HYDI_URL?.replace(/\/$/, '')
const SERVICE_SECRET = process.env.HYDI_SERVICE_SECRET

if (!HYDI_URL || !SERVICE_SECRET) {
  console.error('ERROR: Set HYDI_URL and HYDI_SERVICE_SECRET before running')
  process.exit(1)
}

function makeServiceToken() {
  const ts = Date.now()
  const requestId = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  const service = 'heidi-chat-portal'
  const payload = `${ts}:${requestId}:${service}`
  const sig = createHmac('sha256', SERVICE_SECRET).update(payload).digest('hex')
  return `${ts}.${requestId}.${service}.${sig}`
}

async function callChat(message, system = 'infrastructure') {
  const res = await fetch(`${HYDI_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hydi-service-token': makeServiceToken(),
    },
    body: JSON.stringify({ message, system }),
    signal: AbortSignal.timeout(20_000),
  })
  return { status: res.status, data: await res.json() }
}

function preview(val) {
  const s = typeof val === 'string' ? val : JSON.stringify(val)
  return s.length > 140 ? s.slice(0, 137) + '...' : s
}

const tests = [
  {
    name: 'auth rejection (bad token)',
    run: async () => {
      const res = await fetch(`${HYDI_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-hydi-service-token': 'bad.token.here.now' },
        body: JSON.stringify({ message: 'health', system: 'infrastructure' }),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`)
      return '401 Unauthorized (correct)'
    },
  },
  {
    name: 'deployment status all',
    run: async () => {
      const { status, data } = await callChat('deployment status all')
      if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`)
      return preview(data.response)
    },
  },
  {
    name: 'health check',
    run: async () => {
      const { status, data } = await callChat('health')
      if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`)
      return preview(data.response)
    },
  },
  {
    name: 'device telemetry',
    run: async () => {
      const { status, data } = await callChat('device')
      if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`)
      // Graceful when bridge is offline
      return preview(data.response)
    },
  },
  {
    name: 'help / menu',
    run: async () => {
      const { status, data } = await callChat('help')
      if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`)
      return preview(data.response)
    },
  },
]

async function run() {
  console.log(`Smoke testing HYDI at ${HYDI_URL}\n`)
  let passed = 0
  for (const t of tests) {
    try {
      const result = await t.run()
      console.log(`✅ ${t.name}`)
      console.log(`   ${result}\n`)
      passed++
    } catch (err) {
      console.log(`❌ ${t.name}`)
      console.log(`   ${err.message}\n`)
    }
  }
  console.log(`${passed}/${tests.length} tests passed`)
  process.exit(passed === tests.length ? 0 : 1)
}

run().catch(err => {
  console.error('FATAL:', err.message)
  process.exit(1)
})
