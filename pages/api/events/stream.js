// See pages/api/health.js for why this bridge exists. Already authenticated
// via requireAuth (mobile-ops pattern) and expected live by
// hydi-mobile-protoforge.html, but unreachable under next dev/start until
// bridged — see ISSUES_FOUND.md #34/#49.
export { default } from '../../../api/events/stream.js';
