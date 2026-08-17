// See pages/api/health.js for why this bridge exists. This is the
// "Universal chat router" documented in CLAUDE.md (dispatches { message,
// system } to CASCADE/KILO/ProtoForge/Hyve/Ursula/Rezonate/infrastructure),
// HMAC-service-token gated + rate limited, and ported as a reference
// implementation by termux/hydi-chat-server.js. Distinct from
// pages/api/chat.ts, which is Heidi's own streaming user-chat endpoint.
// Unreachable under next dev/start until bridged — see ISSUES_FOUND.md
// #34/#49.
export { default } from '../../../api/chat/route.js';
