/**
 * Regression test for src/api/services/index.js's POST /subscriptions/checkout.
 *
 * Previously: with `authenticateToken` commented out (its module doesn't
 * even exist -- `middleware/auth.js` is missing), this route fell back to
 * `req.body.customerId || 'cus_test_default'` "for testing" -- meaning any
 * unauthenticated caller could create a Stripe checkout session against an
 * arbitrary customer ID they supplied themselves. Fixed to fail closed
 * (401) instead when there's no authenticated identity.
 */
const express = require('express');
const http = require('http');

jest.mock('../../src/services/subscription-manager', () => {
  return jest.fn().mockImplementation(() => ({
    createCheckoutSession: jest.fn().mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.com/cs_test' }),
  }));
});

const router = require('../../src/api/services/index');

function makeServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/services', router);
  return http.createServer(app);
}

async function post(server, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const { port } = server.address();
      const payload = JSON.stringify(body || {});
      const req = http.request(
        { host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers } },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            server.close();
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
          });
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  });
}

describe('POST /api/services/subscriptions/checkout', () => {
  it('rejects unauthenticated requests with 401, even when a customerId is supplied in the body', async () => {
    const server = makeServer();
    const res = await post(server, '/api/services/subscriptions/checkout', {
      tier: 'pro',
      customerId: 'cus_someone_elses_account',
    });
    expect(res.status).toBe(401);
  });
});
