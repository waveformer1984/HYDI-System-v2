// See pages/api/health.js for why this bridge exists. This route streams
// SSE (Server-Sent Events) and never terminates the response on its own, so
// Next.js's default response-size accounting (which assumes a bounded JSON
// body) is disabled here.
export { default } from '../../../api/events/stream.js';
export const config = { api: { responseLimit: false } };
