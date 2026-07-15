// See pages/api/health.js for why this bridge exists. `checkout-v2.js` was
// a byte-for-byte duplicate of this file (both added in the same commit,
// never diverged) and has been removed — this is the single canonical
// checkout-session-creation endpoint. See ISSUES_FOUND.md #33.
export { default } from '../../api/checkout.js';
