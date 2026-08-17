// See pages/api/health.js for why this bridge exists. Documented as a live
// endpoint (README.md, CLAUDE.md, PROTOFORGE_SITREP.md) but unreachable
// under next dev/start until bridged — see ISSUES_FOUND.md #34/#49.
export { default } from '../../../api/ursula/status.js';
