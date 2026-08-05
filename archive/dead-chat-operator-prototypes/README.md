# Archived: superseded chat-operator prototypes

Moved here 2026-08-05 from `supabase/functions/chat-operator/`.

Supabase deploys an Edge Function from its directory's `index.ts` entrypoint,
so `index.ts` was the only live handler. These two siblings sat beside it as
unreferenced dead code — but dead code of an unusually risky shape, which is
why they were pulled out rather than left in place.

`chat-operator` issues refunds, creates tickets, and runs escalation
workflows. The live `index.ts` was hardened during the 2026-07-17 Edge
Function security audit with two controls that **neither archived file ever
received**:

- **A session-ownership check.** `user_id` arrives from the client and is
  otherwise never verified, so without this check a caller could pass an
  arbitrary `user_id` and, if that user held refund permissions, move money
  as them. `index.ts` now looks up the session's real owner and rejects any
  mismatch (see its `user_id does not match the session owner` branch).
- **Rate limiting**, via `_shared/security.ts`'s `rateLimit()`.

Leaving unhardened copies of a money-moving handler in the deployable
function directory meant a rename or a copy-paste was all that stood between
the fixed privilege-escalation bug and production. Git history retains them
if the prototype logic is ever needed.

## The files

- **`index-deno.ts`** — an earlier, pre-hardening ancestor of the live
  `index.ts`. Functionally the same handler (identical intent detection,
  entity extraction, and tool dispatch); it differs almost entirely in
  formatting, plus the two missing security controls above.
- **`index-new.ts`** — a different, narrower take on the same function, built
  around an explicit `TOOL_WHITELIST` constant. It carries neither the
  session-ownership check nor rate limiting, and its intent detection
  diverges from the live handler's.

## Documentation note

`chat-operator-blueprint-summary.md` pointed at `index-new.ts` as *the*
chat-operator implementation and credited it with "Conversation ownership
verification" — a control that file does not implement. That reference was
corrected to `index.ts` in the same commit that archived these, so the
blueprint no longer directs an implementer at an unhardened file.

Should either prototype ever be revived, port the session-ownership check
and `rateLimit()` call from `index.ts` **first**.
