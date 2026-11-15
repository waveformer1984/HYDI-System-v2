# Heidi capability registry

**Implementation:** `lib/heidi/CapabilityRegistry.ts` (+ `getCapabilityRegistry()`).

**Audit status (2026-11-15):** 77 legacy descriptors lifted to contracts; `capability-contract-audit.ts` reports **VERIFICATION_ABSENT** for all — blocking full autonomy claims.

**Wiring:** `CognitiveCore` consults registry; resource acquisition bindings in `lib/resource-acquisition/capability-bindings.js` (partial registration).

**Do not confuse with:** `src/hydi-v3/CapabilityRegistry.js` (V3 executive simulation).

Next: per-capability verification hooks + undo paths for MEDIUM/HIGH risk actions (`docs/HEIDI_OPERATIONAL_AUTHORITY_MATRIX.md`).