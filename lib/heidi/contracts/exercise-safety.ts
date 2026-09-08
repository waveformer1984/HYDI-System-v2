/**
 * Exercise safety classification.
 *
 * Every capability that enforcement could authorize must carry an explicit,
 * evidence-backed answer to one question: **what happens in the real world if
 * a qualification run executes this?**
 *
 * The taxonomy is three-valued and the distinctions are load-bearing:
 *
 *   LIVE_SAFE_TO_EXERCISE  no meaningful external consequence; run it directly
 *   SANDBOX_REQUIRED       needs a controlled substitute — and whether that
 *                          substitute EXISTS is recorded separately, because
 *                          "needs a sandbox" and "has no sandbox" are
 *                          different states
 *   PROHIBITED             must never be exercised automatically, at any tier
 *
 * This lives as data rather than as a constant inside the harness so the
 * qualification report and the harness cannot drift apart — the same failure
 * mode as two authoritative reports disagreeing about the same contracts.
 *
 * FIRST PASS WAS TOO CONSERVATIVE, AND THAT WAS A REAL COST
 * ---------------------------------------------------------
 * The harness initially marked ten capabilities UNSAFE on the strength of
 * their descriptions. Reading the implementations changed four of those:
 *
 *   - `CustomerLifecycle.activateService()` is a pure UPDATE on
 *     `customer_services`. It makes no Stripe call; the Stripe ids are stored
 *     columns, never invoked. A synthetic harness-created service row is
 *     therefore a complete sandbox with no commercial consequence.
 *   - `comm.send_message` is only external for SOME channels. `heidi_core`,
 *     `web_chat` and `mobile_chat` are local; `email`, `sms` and `webhook`
 *     are not. Its external-ness is a function of an argument.
 *   - `commercial.prepare_outreach` explicitly never sends.
 *
 * Over-conservatism is the safe direction, but it is not free: it reports
 * capabilities as unqualifiable when they are merely un-fixtured, which
 * misdirects the next phase of work.
 */

export type ExerciseSafety =
  | 'LIVE_SAFE_TO_EXERCISE'
  | 'SANDBOX_REQUIRED'
  | 'PROHIBITED';

export interface SafetyClassification {
  capabilityId: string;
  safety: ExerciseSafety;
  /** The concrete real-world side effect of executing this for real. */
  sideEffect: string;
  /**
   * For SANDBOX_REQUIRED: what the controlled substitute is, and whether it
   * exists in this environment. `null` means no sandbox is available yet —
   * which is a blocker, not a pass.
   */
  sandbox: string | null;
  /** Why this classification, in terms of what was read rather than assumed. */
  evidence: string;
  /**
   * Set when the sandbox can EXECUTE the capability but cannot satisfy its
   * verification predicate.
   *
   * This is a third outcome, distinct from both a contract defect and a
   * harness defect: the predicate is right, the fixture is right, and the
   * check still fails because a synthetic substitute is not the real thing.
   * Recording it separately stops a correct refusal being filed as a bug.
   */
  sandboxLimitation?: string;
}

export const EXERCISE_SAFETY: SafetyClassification[] = [
  // ── R4 ──────────────────────────────────────────────────────────────────
  {
    capabilityId: 'tool.send_email',
    safety: 'SANDBOX_REQUIRED',
    sideEffect: 'Delivers a real email to a real address via Resend.',
    sandbox: null,
    evidence:
      'ActionExecutor.sendEmail POSTs api.resend.com/emails and returns the provider id. ' +
      'Resend supports test API keys and reserved test recipients, which would make this ' +
      'exercisable AND independently verifiable via GET /emails/{id}. Neither RESEND_API_KEY ' +
      'nor a test recipient is configured here, so no sandbox exists yet.',
  },
  {
    capabilityId: 'comm.send_message',
    safety: 'SANDBOX_REQUIRED',
    sideEffect:
      'Delivers a message to an external party. Every channel sendMessage can ' +
      'dispatch to — email, sms, notification — leaves the machine.',
    sandbox: null,
    evidence:
      'TWO EARLIER CLAIMS HERE WERE WRONG, both caught by attempting the exercise rather ' +
      'than reasoning about it. (1) I classified heidi_core as a local sandbox because ' +
      'ChannelId separates local from external channels. It is not usable: the sendMessage ' +
      'dispatch explicitly refuses heidi_core/web_chat/mobile_chat with "uses chat(), not ' +
      'sendMessage()". Its switch handles only email, sms and notification — all external. ' +
      '(2) I therefore called the unconditional crossesTrustBoundary on this contract a ' +
      'modelling gap. It is not: for THIS capability every reachable channel is external, ' +
      'so the unconditional declaration is exactly right. ' +
      'No sandbox exists. Delivery verification itself is now unblocked (migration ' +
      '20260819140000 applied; the uuid/text comparison in conversationStore fixed, covered ' +
      'by tests/unit/conversation-store-message-lookup.test.ts) — so the remaining blocker is ' +
      'solely the absence of a non-external recipient.',
  },
  {
    capabilityId: 'revenue.activate_service',
    safety: 'SANDBOX_REQUIRED',
    sideEffect: 'Marks a customer service active and records a service_activated event.',
    sandbox: 'a synthetic customer_services row created and removed by the harness',
    evidence:
      'CustomerLifecycle.activateService() is a pure UPDATE on customer_services plus an event ' +
      'row. It makes NO Stripe call — stripe_customer_id/stripe_subscription_id are stored ' +
      'columns, never invoked. Activating a synthetic row has no commercial consequence. ' +
      'The original UNSAFE classification was written from the description, not the code.',
    sandboxLimitation:
      'Execution succeeds; verification correctly does not. The contract verifies via ' +
      'CustomerLifecycle.verifyService(), which returns verified:false while fulfillment steps ' +
      'are incomplete — and a synthetic service has never completed any. The predicate is ' +
      'right and the fixture is right; a fake service simply is not operational. Fully ' +
      'validating this needs a sandbox that completes fulfillment and exposes a health ' +
      'endpoint, not a looser predicate.',
  },
  {
    capabilityId: 'revenue.start_onboarding',
    safety: 'SANDBOX_REQUIRED',
    sideEffect: 'Creates a customer_services row in provisioning state.',
    sandbox: 'a synthetic customer id and offer id, cleaned up by prefix',
    evidence:
      'CustomerLifecycle writes the row directly; Stripe ids are optional inputs it stores ' +
      'rather than calls. No external effect for a synthetic customer.',
  },
  {
    capabilityId: 'self_sufficiency.run_self_repair',
    safety: 'PROHIBITED',
    sideEffect:
      'Performs real repairs — service restarts, configuration changes — against live services.',
    sandbox: null,
    evidence:
      'Two independent reasons, either sufficient. (1) The effects are real service mutations ' +
      'with no disposable substitute. (2) Its verification is explicitly `unverifiable`: a ' +
      'repair run both repairs and correctly escalates, and those are indistinguishable from ' +
      'outside the engine — so a harness could not detect a failed repair even if it ran one. ' +
      'Exercising an operation whose failure is undetectable produces no evidence.',
  },
  {
    capabilityId: 'revenue.run_cycle',
    safety: 'PROHIBITED',
    sideEffect:
      'Executes a full revenue cycle: scoring, outreach status changes, opportunity creation, ' +
      'provisioning and health decisions against whatever real pipeline data exists.',
    sandbox: null,
    evidence:
      'It selects its own actions from live pipeline state, so a harness cannot bound what it ' +
      'will do. Its six constituent writes are each individually contracted and governed since ' +
      'the bypass fix, and those are the right unit of exercise. Running the composite adds no ' +
      'evidence the parts do not already provide, at far higher risk.',
  },

  // ── R2/R3 previously marked UNSAFE ──────────────────────────────────────
  {
    capabilityId: 'revenue.start_provisioning',
    safety: 'SANDBOX_REQUIRED',
    sideEffect: 'Moves a pending service into provisioning.',
    sandbox: 'a synthetic customer_services row in pending state',
    evidence: 'Pure status UPDATE on customer_services. No external call.',
  },
  {
    capabilityId: 'commercial.prepare_outreach',
    safety: 'LIVE_SAFE_TO_EXERCISE',
    sideEffect:
      'Produces an outreach DRAFT. It never sends — sending is a separate, separately ' +
      'authorized capability.',
    sandbox: null,
    evidence:
      'Registered as R0 and described as "no hallucination, no sending". Generating a draft ' +
      'has no external consequence; the original UNSAFE marking confused producing material ' +
      'with delivering it.',
  },
  {
    capabilityId: 'recovery.governed_recover',
    safety: 'PROHIBITED',
    sideEffect: 'Restarts a live service.',
    sandbox: null,
    evidence:
      'RESTARTABLE_MODULES covers protoforge-core, heidi-web, supabase_* and ollama — the ' +
      'processes this qualification run itself depends on. A harness that restarts its own ' +
      'database is not measuring the system, it is becoming the incident.',
  },
  {
    capabilityId: 'recovery.auto_recover',
    safety: 'PROHIBITED',
    sideEffect: 'Restarts live services without naming a specific target.',
    sandbox: null,
    evidence: 'As above, and broader: it selects its own targets.',
  },
];

const BY_ID = new Map(EXERCISE_SAFETY.map((c) => [c.capabilityId, c]));

export function safetyOf(capabilityId: string): SafetyClassification | null {
  return BY_ID.get(capabilityId) ?? null;
}

/** Capabilities that may never be exercised automatically. */
export function prohibited(): SafetyClassification[] {
  return EXERCISE_SAFETY.filter((c) => c.safety === 'PROHIBITED');
}

/** SANDBOX_REQUIRED entries with no sandbox available — a real blocker. */
export function sandboxUnavailable(): SafetyClassification[] {
  return EXERCISE_SAFETY.filter((c) => c.safety === 'SANDBOX_REQUIRED' && c.sandbox === null);
}
