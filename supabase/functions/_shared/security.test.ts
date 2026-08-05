// Deno-native tests for security.ts. Run via `npm run test:edge` (which
// shells out to `deno test`), or directly with `deno test --allow-env
// supabase/functions/_shared/`. Edge Functions sit outside the Jest/tsc
// pipeline (see tsconfig.json's `exclude`), so this file is not picked up
// by `npm test`.
//
// Assertions come from `node:assert` -- a Deno built-in -- rather than a
// remote `https://deno.land/std@.../testing/asserts.ts` URL. The remote
// import made this file unrunnable in any sandboxed or network-restricted
// environment (it fails at import time, before a single test executes),
// which is a large part of why these tests had never actually been run.
import { strictEqual, ok } from "node:assert";
import { __MAX_BUCKETS, __bucketCount, __resetRateLimit, rateLimit, requireServiceRole } from "./security.ts";

// Wrapped rather than aliased: `node:assert`'s exports are typed as TypeScript
// assertion functions, and an `asserts`-typed function assigned to a `const`
// requires an explicit type annotation, which Deno's type-check rejects.
function assertEquals<T>(actual: T, expected: T): void {
  strictEqual(actual, expected);
}
function assertExists(value: unknown): void {
  ok(value !== null && value !== undefined, "expected value to exist");
}

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

// --- Regression tests for the constant-time secret comparison ---------------

Deno.test("requireServiceRole rejects a token sharing a long prefix with the key", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "the-real-key");
  // Differs only in the final character -- the case a short-circuiting `===`
  // would take measurably longer to reject than a first-character mismatch.
  const result = requireServiceRole(makeRequest({ Authorization: "Bearer the-real-keX" }));
  assertExists(result);
  assertEquals(result?.status, 401);
});

Deno.test("requireServiceRole rejects a token that is a prefix of the key", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "the-real-key");
  const result = requireServiceRole(makeRequest({ Authorization: "Bearer the-real" }));
  assertExists(result);
  assertEquals(result?.status, 401);
});

Deno.test("requireServiceRole rejects a token that extends the key", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "the-real-key");
  const result = requireServiceRole(makeRequest({ Authorization: "Bearer the-real-key-extra" }));
  assertExists(result);
  assertEquals(result?.status, 401);
});

Deno.test("requireServiceRole accepts the key regardless of Bearer casing", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "the-real-key");
  assertEquals(requireServiceRole(makeRequest({ Authorization: "bearer the-real-key" })), null);
});

// --- Regression tests for bounded rate-limit bucket growth ------------------

Deno.test("rateLimit reclaims expired buckets under sustained unique-key load", () => {
  __resetRateLimit();
  // A 1ms window, so each bucket is already expired by the time the next
  // distinct key arrives -- i.e. essentially all of this is reclaimable
  // garbage. Enough keys to cross the size watermark, which is what forces
  // reclamation to track load rather than only the 60s clock.
  const keys = __MAX_BUCKETS - 1_000;
  const opts = { name: "sweep", windowMs: 1, max: 5 };
  for (let i = 0; i < keys; i++) {
    rateLimit(makeRequest({ "x-forwarded-for": `198.51.100.${i}` }), opts);
  }
  // The previous implementation never evicted anything, so this held all
  // `keys` entries. It should now sit far below that.
  ok(
    __bucketCount() < keys / 2,
    `expected expired buckets to be reclaimed, still holding ${__bucketCount()} of ${keys}`,
  );
});

Deno.test("rateLimit enforces a hard ceiling under a flood of unique keys", () => {
  __resetRateLimit();
  // A long window, so nothing expires and only the MAX_BUCKETS backstop can
  // bound growth. `x-forwarded-for` is caller-controlled, so this is exactly
  // the shape an attacker would use to exhaust isolate memory.
  const opts = { name: "flood", windowMs: 3_600_000, max: 100 };
  for (let i = 0; i < __MAX_BUCKETS + 250; i++) {
    rateLimit(makeRequest({ "x-forwarded-for": `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}` }), opts);
  }
  ok(
    __bucketCount() <= __MAX_BUCKETS,
    `bucket count ${__bucketCount()} exceeded the ${__MAX_BUCKETS} ceiling`,
  );
});

Deno.test("rateLimit still blocks a repeat caller after eviction pressure", () => {
  __resetRateLimit();
  const opts = { name: "post-evict", windowMs: 3_600_000, max: 1 };
  const victim = makeRequest({ "x-forwarded-for": "203.0.113.99" });

  assertEquals(rateLimit(victim, opts), null);
  const blocked = rateLimit(victim, opts);
  assertExists(blocked);
  assertEquals(blocked?.status, 429);
});
