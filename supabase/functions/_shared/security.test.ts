// Deno-native tests for security.ts. Run via `deno test` (or Supabase's
// local functions test runner) -- Edge Functions already sit outside the
// Jest/tsc pipeline (see tsconfig.json's `exclude`), so this file is not
// picked up by `npm test`.

import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { __resetRateLimit, rateLimit, requireServiceRole } from "./security.ts";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/", { headers });
}

Deno.test("requireServiceRole rejects a missing Authorization header", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "the-real-key");
  const result = requireServiceRole(makeRequest());
  assertExists(result);
  assertEquals(result?.status, 401);
});

Deno.test("requireServiceRole rejects a token that doesn't match the service role key", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "the-real-key");
  const result = requireServiceRole(makeRequest({ Authorization: "Bearer wrong-key" }));
  assertExists(result);
  assertEquals(result?.status, 401);
});

Deno.test("requireServiceRole accepts a Bearer token matching the service role key", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "the-real-key");
  const result = requireServiceRole(makeRequest({ Authorization: "Bearer the-real-key" }));
  assertEquals(result, null);
});

Deno.test("requireServiceRole fails closed (500) when SUPABASE_SERVICE_ROLE_KEY is unset", () => {
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  const result = requireServiceRole(makeRequest({ Authorization: "Bearer anything" }));
  assertExists(result);
  assertEquals(result?.status, 500);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "the-real-key"); // restore for later tests
});

Deno.test("rateLimit allows requests under the budget and blocks once exceeded", () => {
  __resetRateLimit();
  const req = makeRequest({ "x-forwarded-for": "203.0.113.5" });
  const opts = { name: "test-route", windowMs: 60_000, max: 2 };

  assertEquals(rateLimit(req, opts), null);
  assertEquals(rateLimit(req, opts), null);

  const blocked = rateLimit(req, opts);
  assertExists(blocked);
  assertEquals(blocked?.status, 429);
  assertExists(blocked?.headers.get("Retry-After"));
});

Deno.test("rateLimit tracks separate IPs independently", () => {
  __resetRateLimit();
  const opts = { name: "test-route-2", windowMs: 60_000, max: 1 };

  const reqA = makeRequest({ "x-forwarded-for": "203.0.113.10" });
  const reqB = makeRequest({ "x-forwarded-for": "203.0.113.20" });

  assertEquals(rateLimit(reqA, opts), null);
  assertExists(rateLimit(reqA, opts)); // second request from A is blocked
  assertEquals(rateLimit(reqB, opts), null); // B has its own budget
});
